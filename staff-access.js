/* Password credentials stay in Firebase Auth; approval is administrator-only. */
(function(root){
  'use strict';
  function staffLoginEmail(identifier){
    const value=String(identifier||'').trim().toLowerCase();
    if(value.includes('@')){
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))throw new Error('invalid-identifier');
      return value;
    }
    if(!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(value))throw new Error('invalid-identifier');
    return value+'@staff.ky-rent-system.invalid';
  }
  async function signInStaff(auth,identifier,password,remember,persistence){
    const email=staffLoginEmail(identifier);
    if(typeof password!=='string'||!password)throw new Error('missing-password');
    await auth.setPersistence(remember?persistence.LOCAL:persistence.SESSION);
    return auth.signInWithEmailAndPassword(email,password);
  }
  class StaffAccessGate{
    constructor(options){this.options=options;this.user=null;this.unsubscribe=null;this.granted=false;this.generation=0}
    block(reason){this.granted=false;this.options.onBlocked(reason,this.user)}
    stop(){this.generation++;if(this.unsubscribe)this.unsubscribe();this.unsubscribe=null;this.user=null;this.block('signed-out')}
    start(user){
      this.stop();this.user=user;if(!user)return;
      if(user.isAnonymous||!user.providerData?.some(provider=>provider.providerId==='password')){this.block('sign-in-required');return}
      const generation=this.generation;this.block('checking');
      this.unsubscribe=this.options.db.collection('staffAccounts').doc(user.uid).onSnapshot({includeMetadataChanges:true},snapshot=>{
        if(this.generation!==generation||this.user!==user)return;
        // A cached approval cannot authorize a new session or override revocation.
        if(snapshot.metadata?.fromCache){if(!this.granted)this.block('checking');return}
        if(snapshot.exists&&snapshot.data()?.enabled===true){
          if(!this.granted){this.granted=true;this.options.onGranted(user)}
        }else this.block('approval-required');
      },()=>{if(this.generation===generation&&this.user===user)this.block('unavailable')});
    }
    retry(){this.start(this.user)}
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={StaffAccessGate,staffLoginEmail,signInStaff};
  else{root.StaffAccessGate=StaffAccessGate;root.staffLoginEmail=staffLoginEmail;root.signInStaff=signInStaff}
})(typeof window==='undefined'?this:window);
