import React, {Component, Fragment} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Button} from '@astryxdesign/core/Button';
import {Badge} from '@astryxdesign/core/Badge';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Table, TableHeader, TableHeaderCell, TableBody, TableRow, TableCell} from '@astryxdesign/core/Table';
import '@astryxdesign/core/astryx.css';
import '@astryxdesign/theme-neutral/theme.css';
import './reservations.css';

const app = window;
const periodOptions = [
  ['upcoming', '예정 예약'], ['today', '오늘'], ['tomorrow', '내일'],
  ['week', '이번 주'], ['all', '전체'],
];
const metricOptions = [
  ['pickup', '오늘 배차', 's-today'], ['return', '오늘 반납', 's-return'],
  ['active', '운행중', 's-active'], ['unpaid', '미수금', 's-unpaid'],
  ['unassigned', '차량 미배정', 's-unassigned'], ['attention', '확인 필요', 's-flag'],
];
const statuses = {wait: ['대기', 'yellow'], active: ['운행중', 'blue'], done: ['완료', 'neutral'], cancelled: ['취소', 'neutral']};

function editField(record, field) {
  app.startEdit({dataset: {id: record.id, field}});
}

function EditValue({record, field, children, label, className = ''}) {
  return <button type="button" className={'ky-cell-edit ' + className}
    aria-label={label + ' 수정'} onClick={() => editField(record, field)}>
    {children}
  </button>;
}

function ReservationStatus({record}) {
  const [label, variant] = statuses[record.status] || statuses.wait;
  return <span className="ky-status">
    <Badge label={label} variant={variant}/>
    {app.isDriverReservation(record) && <Badge label="운행기사" variant="teal"/>}
    {app.hasConflict(record) && <Badge label="일정 중복" variant="red"/>}
  </span>;
}

function ReservationTime({value}) {
  const formatted = app.fmtShort(value);
  const split = formatted.lastIndexOf(' ');
  if (split < 0) return <span>{formatted || '미정'}</span>;
  return <span className="ky-time"><span>{formatted.slice(0, split)}</span><strong>{formatted.slice(split + 1)}</strong></span>;
}

function InsertRow({index}) {
  return <TableRow className="ky-insert-row">
    <TableCell colSpan={9}>
      <Button label={index < 0 ? '맨 앞에 예약 추가' : '여기에 예약 삽입'} variant="ghost" size="sm"
        onClick={() => app.insertBetween(index)}/>
    </TableCell>
  </TableRow>;
}

function ReservationTable({rows}) {
  return <Table className="ky-table" aria-label="예약 목록" density="compact" dividers="rows" hasHover>
    <TableHeader>
      <TableRow>
        {['대여', '반납', '차량 · 번호', '고객 · 연락처', '배차 장소', '회차 장소', '잔금', '상태', '관리'].map((label, i) =>
          <TableHeaderCell key={label} className={'ky-col-' + i}>{label}</TableHeaderCell>)}
      </TableRow>
    </TableHeader>
    <TableBody>
      <InsertRow index={-1}/>
      {rows.map((record, index) => {
        const plate = app.reservationVehicleId(record);
        const balance = app.reservationBalance(record);
        return <Fragment key={record.id}>
          <TableRow className={app.hasConflict(record) ? 'ky-conflict-row' : ''} data-reservation-id={record.id}>
            <TableCell><EditValue record={record} field="start" label="대여 일시"><ReservationTime value={record.start}/></EditValue></TableCell>
            <TableCell><EditValue record={record} field="end" label="반납 일시"><ReservationTime value={record.end}/></EditValue></TableCell>
            <TableCell>
              <div className="ky-cell-stack">
                <EditValue record={record} field="carName" label="차량" className="ky-car">{app.reservationVehicleName(record) || '차량 미정'}</EditValue>
                <button type="button" className={'ky-plate ' + (!plate ? 'ky-missing' : '')}
                  onClick={event => app.openPlatePicker(event.currentTarget, record.id)}
                  aria-label={(plate || '미배정') + ' 차량번호 변경'}>{plate || '차량 배정'}</button>
              </div>
            </TableCell>
            <TableCell>
              <div className="ky-cell-stack">
                <EditValue record={record} field="name" label="고객명" className="ky-customer">{app.reservationCustomerName(record)}</EditValue>
                <EditValue record={record} field="phone" label="연락처" className="ky-secondary">{record.phone || '연락처 미기재'}</EditValue>
              </div>
            </TableCell>
            <TableCell><EditValue record={record} field="pickup" label="배차 장소">{record.pickup || '장소 미정'}</EditValue></TableCell>
            <TableCell><EditValue record={record} field="ret" label="회차 장소">{record.ret || record.pickup || '사무실'}</EditValue></TableCell>
            <TableCell className="ky-money">
              <EditValue record={record} field="balance" label="잔금" className={balance > 0 ? 'ky-balance-due' : ''}>
                {balance === null ? '' : balance === 0 ? '완납' : balance.toLocaleString('ko-KR') + '원'}
              </EditValue>
            </TableCell>
            <TableCell><ReservationStatus record={record}/></TableCell>
            <TableCell className="ky-actions-cell">
              <div className="ky-row-actions">
                <Button label="수정" variant="secondary" size="sm" onClick={() => app.editRes(record.id)}/>
                {['wait', 'active'].includes(record.status) &&
                  <Button label={record.status === 'active' ? '반납' : '배차'} variant="ghost" size="sm" onClick={() => app.cycleStatus(record.id)}/>}
                <Button label="삭제" variant="ghost" size="sm" className="ky-delete" onClick={() => app.delRes(record.id)}/>
              </div>
            </TableCell>
          </TableRow>
          <InsertRow index={index}/>
        </Fragment>;
      })}
    </TableBody>
  </Table>;
}

function MobileReservations({rows, metric, range}) {
  let previousDay = null;
  return <div className="ky-mobile-list">
    {rows.map(record => {
      const event = app.reservationListEvent(record, range, metric);
      const byEnd = event?.type === 'return';
      const date = String(event?.time || '').slice(0, 10);
      const showDate = date !== previousDay;
      previousDay = date;
      const balance = app.reservationBalance(record);
      return <Fragment key={record.id}>
        {showDate && <h3 className="ky-day">{app.mDayLabel(date)}</h3>}
        <button className="ky-mobile-row" type="button" onClick={() => app.openMobileSheet(record.id)}>
          <span className="ky-mobile-title"><strong>{app.reservationVehicleName(record) || '차량 미정'}</strong>
            <span className="ky-plate">{app.reservationVehicleId(record) || '차량 미배정'}</span></span>
          <span className="ky-mobile-summary">{app.reservationCustomerName(record)} · {app.fmtShort(record.start)} ~ {app.fmtShort(record.end)}</span>
          <span className="ky-mobile-location">{byEnd ? '회차 ' : '배차 '}{(byEnd ? record.ret || record.pickup : record.pickup) || '장소 미정'}</span>
          <span className="ky-mobile-footer"><ReservationStatus record={record}/>
            <span className={balance > 0 ? 'ky-balance-due' : 'ky-secondary'}>{balance === null ? '' : balance === 0 ? '완납' : '잔금 ' + balance.toLocaleString('ko-KR') + '원'}</span>
          </span>
        </button>
      </Fragment>;
    })}
  </div>;
}

function Reservations({rows, period, metric, query, compact, metrics, title, range}) {
  const filtered = period !== 'upcoming' || metric !== 'all' || query !== '';
  return <div className="ky-reservations" data-astryx-theme="neutral" data-theme="light">
    <header className="ky-header">
      <div><h2>{title}</h2><p>{range ? range.join(' ~ ') : '고객 · 차량 · 배차 및 반납 일정'}</p></div>
      <div className="ky-header-actions">
        <Button label="되돌리기" variant="ghost" onClick={() => app.undo()}/>
        <Button label="엑셀" variant="secondary" onClick={() => app.exportExcel()}/>
        <Button label="예약 추가" variant="primary" onClick={() => {app.clearForm(); app.openReservationPanel();}}/>
      </div>
    </header>
    <section className="ky-metrics" aria-label="예약 업무 현황">
      {metricOptions.map(([key, label, id]) => <button key={key} type="button" className={key === 'unpaid' ? 'ky-metric ky-metric-money' : 'ky-metric'}
        aria-pressed={metric === key} onClick={() => app.setDashboardMetric(key)}>
        <span>{label}</span><strong className={key === 'attention' && parseInt(metrics[id], 10) > 0 ? 'ky-attention' : ''}>{metrics[id]}</strong>
      </button>)}
    </section>
    <section className="ky-register" aria-label="예약 조회">
      <div className="ky-filterbar">
        <div className="ky-periods" role="group" aria-label="조회 기간">
          {periodOptions.map(([value, label]) => <Button key={value} label={label} variant="ghost"
            aria-pressed={period === value && metric === 'all'} onClick={() => app.setDashboardPeriod(value)}/>)}
        </div>
        <div className="ky-search">
          <TextInput type="search" label="예약 검색" isLabelHidden size="lg" value={query}
            placeholder="이름·차량번호·연락처·장소 검색" onChange={value => {
              document.getElementById('search').value = value;
              app.renderReservationList();
            }}/>
        </div>
      </div>
      <div className="ky-result">
        <span role="status" aria-live="polite"><b>{rows.length.toLocaleString('ko-KR')}건</b>{metric !== 'all' && ' · ' + title}
          {range && <span className="ky-range">{range[0]}{range[0] !== range[1] && ' ~ ' + range[1]}{metric === 'all' && ' · 배차·반납일 기준'}</span>}
        </span>
        {filtered && <Button label="필터 초기화" variant="ghost" size="sm" onClick={() => app.resetDashboardFilters()}/>}
      </div>
      {!rows.length ? <div className="ky-empty"><strong>조건에 맞는 예약이 없습니다</strong>
        <span>조회 기간을 바꾸거나 새 예약을 추가해 주세요.</span>
        <Button label="예약 추가" variant="secondary" onClick={() => app.insertBetween(-1)}/>
      </div> : compact ? <MobileReservations rows={rows} metric={metric} range={range}/> : <ReservationTable rows={rows}/>}
    </section>
  </div>;
}

const host = document.getElementById('reservation-astryx-root');
const view = document.getElementById('view-reservations');

class ReservationBoundary extends Component {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  componentDidCatch(error) {
    console.error('Reservation UI failed to render', error);
    queueMicrotask(() => {
      app.kyReservationUI = null;
      host.hidden = true;
      view.classList.remove('astryx-ready');
      app.renderReservationList();
    });
  }
  render() { return this.state.failed ? null : this.props.children; }
}

const root = createRoot(host);
app.kyReservationUI = {
  render(state) {
    flushSync(() => root.render(<ReservationBoundary><Reservations {...state}/></ReservationBoundary>));
    host.hidden = false;
    view.classList.add('astryx-ready');
  },
};
if (view.classList.contains('on')) app.render();
