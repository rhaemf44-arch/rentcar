# 디자인 규칙 (Design Rules)

UI를 만들거나 고칠 때는 아래 규칙이 기본값이다. 스킬 가이드와 충돌하면 이 문서가 우선한다.

## 스킬 사용 순서

| 상황 | 스킬 |
| --- | --- |
| 새 화면·페이지의 방향 잡기, 랜딩/마케팅 페이지 | `design-taste-frontend` (taste-skill) |
| 설계·리뷰·폴리싱 (`/impeccable audit`, `polish`, `typeset`, `layout`, `animate` …) | `impeccable` |
| 컴포넌트 디테일, 인터랙션, 모션 | `emil-design-eng`, `animate`, `review-animations`, `animation-performance` |

작업 순서: 방향(taste) → 구현 → 검증(impeccable audit + Playwright 스크린샷) → 모션 리뷰(review-animations).

## 1. 타이포그래피

- 서체는 최대 2개(디스플레이 1 + 본문 1). Inter·Roboto·Arial 기본값으로 때우지 않는다. 한글은 Pretendard / SUIT / Noto Sans KR 중 택1.
- 크기 단계는 최대 5개, 단계 사이는 확실히 벌린다. 16·18·20·24처럼 붙은 크기를 나열하지 않는다.

```css
:root {
  --text-sm:      clamp(0.8125rem, 0.79rem + 0.1vw, 0.875rem); /* 13–14px 캡션 */
  --text-base:    clamp(1rem, 0.96rem + 0.2vw, 1.125rem);      /* 16–18px 본문 */
  --text-lead:    clamp(1.25rem, 1.1rem + 0.7vw, 1.625rem);    /* 20–26px 리드 */
  --text-head:    clamp(2rem, 1.3rem + 3.2vw, 4rem);           /* 32–64px 섹션 제목 */
  --text-display: clamp(3rem, 1rem + 9vw, 9rem);               /* 히어로 */
}
```

- 디스플레이 크기 ≥ 본문 × 4 (데스크톱). 위계는 굵기보다 크기·여백으로 만든다.
- 행간: 본문 1.5–1.7(한글 1.6–1.8), 제목 1.0–1.2. 자간: 큰 제목일수록 좁게(-0.01 ~ -0.03em), 대문자 라벨은 +0.04 ~ +0.08em. 한글 본문은 자간 0.
- 본문 한 줄 45–75자(`max-width: 65ch`, 한글 `36em` 내외). 제목은 `text-wrap: balance`, 본문은 `text-wrap: pretty`, 한글은 `word-break: keep-all`.
- 숫자 표·카운터는 `font-variant-numeric: tabular-nums`.
- 폰트는 `font-display: swap` + 필요한 굵기만 로드. 굵기는 400/500/600(+디스플레이용 1개)까지.

## 2. 간격

- 4px 기본 단위, 8px 리듬. 토큰 밖의 임의 값(13px, 22px 등) 금지.

```css
:root {
  --space-1: 4px;  --space-2: 8px;   --space-3: 12px;  --space-4: 16px;
  --space-5: 24px; --space-6: 32px;  --space-7: 48px;  --space-8: 64px;
  --space-9: 96px; --space-10: 128px;
  --section-y: clamp(4rem, 2rem + 8vw, 10rem);
  --gutter:    clamp(1rem, 0.5rem + 2.5vw, 2.5rem);
}
```

- 근접성: 관련된 요소 사이 간격 < 그룹 사이 간격 < 섹션 사이 간격. 최소 1.5–2배 차이를 둔다.
- 컴포넌트 내부 패딩 ≤ 외부 마진. 라벨↔입력 `--space-2`, 필드 사이 `--space-5`.
- 간격은 부모의 `gap`으로 준다. 자식 마진으로 간격 조절하지 않는다.
- 터치 타깃 최소 44×44px.

## 3. 레이아웃

- 12컬럼 그리드(데스크톱), 8컬럼(태블릿), 4컬럼(모바일). 콘텐츠 최대폭 `1200–1320px`, 좌우 여백 `--gutter`.
- 브레이크포인트: 640 / 768 / 1024 / 1280. 모바일 우선, 390px 폭에서 가로 스크롤 0.
- 모든 섹션이 가운데 정렬 + 3열 카드인 템플릿형 구성 금지. 비대칭 분할(7/5, 8/4), 정렬축 하나를 정하고 지킨다.
- 카드 안에 카드 중첩 금지. 테두리·그림자·배경 중 하나로만 영역을 구분한다.
- 모서리 반경은 2단계(예: 6px 컨트롤 / 12px 컨테이너)로 통일. 중첩 시 안쪽 반경 = 바깥 반경 − 패딩.
- 레이아웃은 Flex/Grid로, 고정 높이 금지(`min-height`만). 레이아웃 시프트를 막기 위해 이미지·미디어에 `aspect-ratio` 지정.
- 빈 상태·로딩·오류·긴 텍스트·한 글자 텍스트 상태를 모두 설계한다.

## 4. 애니메이션 (Emil Kowalski 원칙)

- 목적 없는 모션 금지. 하루 수십 번 쓰는 동작(키보드 단축키, 자주 쓰는 메뉴)은 애니메이션 없음 또는 최소화.
- `transform`과 `opacity`만 애니메이트. `transition: all` 금지 — 속성을 명시한다.

```css
:root {
  --ease-out:    cubic-bezier(0.23, 1, 0.32, 1);    /* 기본: 진입·UI 반응 */
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);   /* 화면 위 이동 */
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);    /* 드로어·시트 */
  --dur-press:   140ms;  /* 버튼 눌림 100–160 */
  --dur-fast:    160ms;  /* 툴팁·작은 팝오버 125–200 */
  --dur-base:    200ms;  /* 드롭다운·셀렉트 150–250 */
  --dur-slow:    320ms;  /* 모달·드로어 200–500 */
}
```

- UI 애니메이션은 300ms 이하가 원칙. `ease-in`은 UI에 쓰지 않는다(느리게 느껴짐). 기본은 `ease-out`.
- `scale(0)`에서 시작하지 않는다 → `scale(0.95)` + `opacity: 0`.
- 버튼은 `:active { transform: scale(0.97) }`.
- 팝오버·드롭다운은 트리거 기준 `transform-origin`, 모달만 중앙.
- 퇴장은 진입보다 짧게(약 70%). 리스트 스태거는 항목당 30–50ms, 전체 300ms 이내.
- 드래그·제스처 등 중단 가능한 모션은 스프링(`bounce` 0–0.2) 사용.
- `prefers-reduced-motion: reduce`에서는 이동/스케일을 제거하고 opacity만 남긴다.
- `will-change`는 애니메이션 중에만, 레이아웃 속성(width/height/top/left) 애니메이트 금지.

## 5. 검증

- 변경 후 Playwright MCP로 1440×900, 390×844 스크린샷을 찍어 확인한다.
- Figma 링크가 주어지면 Figma MCP로 디자인 컨텍스트·변수(토큰)를 먼저 읽고, 위 토큰과 매핑해 구현한다.
- 마무리 전에 `/impeccable audit` 로 점검하고, 모션이 있으면 `review-animations` 로 리뷰한다.
