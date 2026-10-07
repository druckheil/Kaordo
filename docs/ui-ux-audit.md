# UI/UX audit — 7 October 2026

## Scope and interpretation

Reviewed Portal, Fluo, Ligo, Rondo, Lingvo, Regado, shared account/chat/media presentation, appearance preferences and native Keycloak credential forms. The starting revision was `9ad1a0095882068846cf826cd180446a0a81642b`; the evidence below concerns the audit changes in the working tree. The initial tree was clean. No production release accompanies this audit.

The review combines rendered-screen inspection, source review, synthetic browser journeys, semantic color measurements and live product journeys. It covers implemented features; reserved Matrix/encryption integrations and other unimplemented settings are not scored as delivered functionality.

The contexts are a guest/new account, an authenticated member and an administrator, using a keyboard/mouse or simulated touch. Desktop layouts, 320px/390px narrow layouts, a short landscape viewport, 200% text, WCAG text spacing, light/dark palettes and Windows forced-color emulation are represented. The browser engines are Chromium, WebKit and Firefox on macOS. These contexts make the score reviewable; they do not represent every device or every user's needs.

### Task coverage

| Area | Reviewed tasks and states |
| --- | --- |
| Portal/account | App entry, guest/loading/error/connected states, sign in/out, native registration/password/TOTP/recovery forms, appearance preferences, release history and skip navigation |
| Fluo | Feed, search/result/empty states, profile, saved/empty posts, ownership menus, reactions, sharing/fallback, post/reply/quote composition, media paste, notifications/read state and notification/privacy choices |
| Ligo | Conversation selection/creation, native scrolling, text/media/caption composition, message actions/reactions, lost live connection/reconnect and preserved drafts |
| Rondo | Servers/channels/member panels, responsive conversation, shared message actions/composition, voice/camera controls and device/volume settings |
| Lingvo | Native-language pair, dashboard, words/phrases, card/articles/AI input, library previews, dictionary/search, folders, transfer, preferences, practice focus/rating/undo and save/review failures |
| Regado | Overview, Storage, System, Users, Audit and Logs, responsive charts, URL/history/reload, access cases, and guarded administrative dialogs |

### Frameworks

- **ISO 9241-11:** inspect whether intended tasks can be completed, how much interaction they require, and whether the interface supports a clear, recoverable experience in the tested context. Actual satisfaction and real-user task efficiency require a user study. ISO supplies a usability framework, not a universal 0–100 product score. [ISO 9241-11:2018](https://www.iso.org/standard/63500.html)
- **WCAG:** use 2.2 A/AA as the engineering target for names, semantics, keyboard access, focus, contrast, resizing and reflow. Automated scans are supplemented by interaction and geometry assertions. A passing scan alone cannot establish full conformance. [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [Understanding WCAG](https://www.w3.org/WAI/WCAG22/Understanding/)
- **UEQ:** apply attractiveness, perspicuity, efficiency, dependability, stimulation and novelty as review prompts. No respondents completed the 26-item questionnaire; no UEQ participant score or benchmark percentile is claimed. [UEQ handbook](https://ueq-online.org/Material/Handbook.pdf)
- **VisAWI:** inspect simplicity, diversity, colorfulness and craftsmanship. This is an expert aesthetic review, not a completed 18-item respondent survey. [Original instrument](https://www.sciencedirect.com/science/article/pii/S1071581910000777), [English validation](https://www.tandfonline.com/doi/full/10.1080/10447318.2023.2258634)

## Findings and completed improvements

| Finding | Improvement and ownership | Regression evidence |
| --- | --- | --- |
| Portal and Regado used separate header implementations; account access screens lacked consistent app navigation | Compose the shared `AppHeader`, including action slots, compact mobile navigation, skip link and a single main landmark | Public entry, keyboard skip, Portal views and Regado sections |
| Enlarged text could push header controls and theme labels outside the viewport | Allow header content to wrap; keep mobile app navigation compact; wrap theme names/default labels independently | 200% text, text spacing, 320px reflow and short landscape viewport |
| Decorative ring/divider colors were also used for control identification | Add shared `control-border`/`focus-color` tokens; distinguish field boundaries and solid keyboard outlines from decorative dividers | Seven themes × two modes × twenty semantic pairs |
| Small slider thumbs, reaction chips and touch fields were difficult targets | Use a literal 24px slider minimum independent of theme spacing, larger message reaction chips, 44px touch buttons/fields and associated choice labels | Minimum target geometry and coarse-pointer journeys |
| Large dialogs/popovers could exceed available screen space | Bound shared Dialog, Alert Dialog and Popover surfaces; retain native internal scrolling and Bits UI focus behavior | Add-card, AI details, transfer, folders, preferences, composer, share and action dialogs |
| Fluo rich text did not expose textbox semantics | Give the editor a descriptive textbox role and multiline state; remove hidden file inputs from keyboard navigation | Role/label selectors, keyboard use and automated accessibility |
| The shared focus outline drew a square inside the rounded Fluo editor | Keep the editor surface free of an inner outline and use the rounded draft container for keyboard focus; reuse Bits UI's `IsUsingKeyboard` state | Pointer focus has no added frame; keyboard entry shows a rounded external outline while the inner editor remains unframed |
| Fluo's visible Share action was permanently disabled | Share through the native API, copy a public link with announced feedback, or offer a selectable manual link when clipboard access fails | Clipboard success/failure, exact URL, responsive fallback and focus return |
| Fluo feed measurement could update layout during ResizeObserver delivery | Enable TanStack Virtual's animation-frame measurement option, coalesce scroll-margin updates and cancel pending work on teardown | Repeated viewport changes and closing Share in WebKit without ResizeObserver loop errors |
| Messaging showed a technical connection error or an indefinite reconnect state | Own and cancel SSE attempts; show actionable reconnect feedback and retain TanStack Query refresh every five seconds when live delivery is unavailable | Injected SSE failure, reconnect, draft preservation and subsequent message requests |
| Rondo's fixed pixel breakpoints ignored enlarged text while panel widths used rem units | Measure the actual layout and apply the same font-relative thresholds to panel visibility; keep members available through the existing dialog | 200% text no longer reduces the message input to a 16px strip |
| Regado navigation was transient state, so reload/back lost the selected section | Derive the section from SvelteKit's URL, preserve focus on navigation, expose the current page and give each section an h1/title | Six sections, history back/forward, reload, guarded operations |
| Lingvo's mobile navigation and dense article/goal choices crowded narrow screens | Show all four destinations in a two-column mobile grid; use two-column article choices and three-column goal choices | Learning, dictionary, library, editor and preferences at 320px |
| Opening a cold Lingvo editor could trigger Vite dependency discovery and a full document reload | Prebundle the dependencies through their owning workspace package, using Vite's nested dependency include syntax | No navigation/reload while opening and saving a card; draft survives errors |
| First media submission could discover Uppy, Pica or tus dependencies and reload the document, losing a draft | Prepare the shared media package's lazy dependencies in Fluo, Ligo and Rondo; keep in-memory authentication outside the bundle | Fresh-server, empty-cache first submissions upload four images, retain the text, receive 201 and assert no document navigation or Vite full reload |
| Lingvo's flipped card could leave focus in an inert face; review shortcuts were global | Move focus to recall controls on reveal and to the question on the next card/undo; enable shortcuts only inside focused practice | Space reveal, numeric ratings, undo and no review when focus is outside practice |
| Recall interval text lost contrast through opacity | Keep the semantic foreground at full opacity | Light/dark answer screens and palette checks |
| Translation examples lacked their language metadata; explanatory text exposed scheduling implementation details | Mark native-language text, keep German metadata, and describe the learning outcome in product language | Card definitions in practice, dictionary and library |
| Decorative floating animation continued indefinitely | Keep useful transitions and response feedback, remove continuous decorative floating; respect reduced motion | Reduced-motion suite and normal-motion composer bounds |
| Forced colors did not expose a consistent system-color control state in computed styles | Use system button/link/focus colors and an outline for the current destination | Forced-color screens and keyboard outline assertions |
| The dependency scanner interpreted import/export UI copy as code | Match module import grammar and retain explicit regressions for static, dynamic and CSS imports | Workspace dependency ownership suite |
| WebKit's native selects ignored minimum height and became small targets; select styling did not share field focus/boundary rules | Give single-select controls an explicit shared height, semantic boundary and keyboard outline while retaining their native interaction | All Regado sections, narrow reflow, target geometry and keyboard focus on journal retention |
| Named message/media containers and virtual posts lacked corresponding collection/group semantics | Expose message/media groups and a virtual list with item positions and known/unknown total size | Automated scans in all three browser engines |
| Media paste assumed that a browser always populated `DataTransfer.files` | Share a pure file-extraction helper that falls back to file items; retain Tiptap FileHandler for its standard path and default rich-text/caption paste | Native PNG paste in Ligo/Rondo, item-only Fluo/chat paste, captions and attachment limits |
| Safari mouse activation did not give the Share button focus before a fallback dialog | Return focus through Bits UI's close-autofocus hook to the bound Share button | Clipboard failure, dialog close and focused trigger in all engines |
| Single-card dictionary counts used plural copy | Use singular/plural wording for words, phrases and total reviews | A persisted single-word dictionary after reload |

The implementation keeps the existing STaSBLR ownership: Rhea/shadcn-svelte surfaces, Bits UI keyboard/focus behavior, Tailwind semantic tokens and Lucide icons. TanStack Query owns retry/refetch/cache behavior; native ResizeObserver and requestAnimationFrame handle measurement. No new runtime library or parallel design system was introduced. Browser fixture servers own and clean up temporary Vite dependency caches, so verification cannot accidentally depend on a developer's warm cache. A cold restart replaces the worker's existing app server to keep one owner of generated SvelteKit source. Synthetic binary submissions use an owned HTTP endpoint and assert the actual byte count, PNG signature and dimensions; this avoids WebKit's missing intercepted Blob bodies without reducing coverage.

## Evaluation rubric

The requested **UI/UX Quality Score** is a project-specific expert estimate. It is not an ISO, WCAG, UEQ or VisAWI certification. Each of the twelve categories is rated from 0 to 5 against the five review prompts below. Normalize with `category = rating / 5 × 100`; the overall score is the equally weighted mean. Scores near 5 mean that the reviewed flows pass their checks and the expert review found no remaining material issue. Small differences near the top are judgment, not measurement precision or a probability of being bug free.

Rating anchors: 0 means blocked or absent; 1 means severe friction; 2 means partial usability; 3 means usable with repeated friction; 4 means reliable with minor friction; 5 means no material defect observed against the review prompts in the stated contexts. Fractional ratings express the expert's uncertainty and remaining polish opportunity. They are not fabricated questionnaire answers.

| Category | Five review prompts |
| --- | --- |
| Usability | Task completion; visible actions; manageable steps; recoverable errors; preserved user work |
| UX | Clarity; efficiency; dependability; purposeful stimulation; useful feature discovery |
| Visual aesthetics | Simplicity; controlled variety; coherent color; craftsmanship; restrained motion |
| Consistency | Shared shell; primitive behavior; semantic tokens; vocabulary; cross-app patterns |
| Accessibility | Semantics/names; keyboard/focus; text/control contrast; target access; resizing/reflow |
| Hierarchy | Page identity; main action; secondary actions; grouping; empty/loading/error priority |
| Typography | Readability; scale; line height; wrapping/language metadata; enlarged/text-spaced use |
| Spacing | Rhythm; grouping; field/action density; modal bounds; mobile padding |
| Colors | Foreground/background pairing; muted copy; status meaning; light/dark consistency; forced colors |
| Navigation | App entry; visible destinations; selected state; URL/history coherence; dialog return |
| Feedback | Pending state; successful actions; errors/retry; reconnect state; motion/focus response |
| Responsiveness | Narrow layouts; touch targets; short viewports; enlarged text; scroll ownership |

### Final expert assessment

| Category | Rating / 5 | Normalized / 100 | Basis within the reviewed contexts |
| --- | ---: | ---: | --- |
| Usability | 4.95 | 99 | Complete product journeys, recoverable failures and preserved drafts; first submissions also work with an empty dependency cache |
| UX | 4.90 | 98 | Clear choices, scoped practice shortcuts, actionable connection feedback and restrained motion; subjective experience still needs participant research |
| Visual aesthetics | 4.95 | 99 | Shared surfaces, coherent themes, readable density and purposeful animation; rendered states reviewed in both modes |
| Consistency | 5.00 | 100 | Shared shell, primitive interaction, control tokens and vocabulary across the implemented applications |
| Accessibility | 4.90 | 98 | A/AA scans plus contrast, semantics, keyboard, targets and reflow assertions; screen-reader and real-device evaluation remains outside this run |
| Hierarchy | 4.95 | 99 | Explicit page identity, distinguishable primary actions, grouped secondary controls and visible error/empty states |
| Typography | 4.95 | 99 | Readable line height, language metadata and wrapping; 200% text and user-defined spacing retain the reviewed controls |
| Spacing | 4.95 | 99 | Consistent control density, native scrolling, bounded overlays and mobile padding without observed overlap |
| Colors | 5.00 | 100 | All 280 reviewed semantic pairings pass their contrast thresholds; light/dark and forced-color states retain meaningful controls |
| Navigation | 4.95 | 99 | Visible destinations, skip navigation, current state, Regado URL/history and dialog focus return |
| Feedback | 4.95 | 99 | Pending, success, error, reconnect and copy states are actionable; draft and focus recovery are covered |
| Responsiveness | 4.95 | 99 | Narrow, touch, short-height, enlarged-text and text-spacing contexts retain content and action access |

**Overall: 99.0/100. Lowest category: 98/100.** The arithmetic meets the requested target within this expert rubric. There is no externally defined “99/100 quality norm” in the cited standards, and this number does not turn the evidence into certification or a measured user-survey result. The 98-point categories retain uncertainty about participant experience and assistive-technology/device behavior; those are not claimed as verified.

## Verification record

Browser checks use synthetic accounts and media. Native credential journeys disable traces and screenshots; their temporary accounts/application rows are cleaned up. The application source is frozen during browser verification: builds and Svelte checks run first, and fixture suites run sequentially.

| Layer | Command | Latest result |
| --- | --- | --- |
| Svelte/TypeScript | `pnpm check:front` | Seven checked projects, zero errors and zero Svelte warnings |
| Static artifact | `pnpm test:pages` | All six app builds; 9/9 artifact/configuration checks |
| Unit/configuration/ownership | `pnpm test:unit` | 133 passed, zero failures, 2 environment skips; 15.19s |
| Chromium | `KAORDO_UI_SCREENSHOTS=1 pnpm exec playwright test --project=browser --workers=1` | 37/37 passed, zero retries; 2.8m |
| WebKit/Firefox | `KAORDO_UI_SCREENSHOTS=1 pnpm test:ui:browsers` | 64/64 passed, zero retries; 5.8m |
| Native identity and live product | `KAORDO_UI_SNAPSHOTS=0 pnpm test:auth:live` | 4/4 passed, zero retries; 1.3m |

The two unit skips are occupied-port startup tests: “a second pnpm dev fails before starting Docker or reporting ready” and “the standalone site reports an occupied port without an uncaught exception”. The existing development stack owns Kerno and the site ports; it was preserved. The lower-level free/occupied-port preflight test passed. These are explicit gaps in this local run, not passed tests.

All 101 browser scenarios passed: 37 in Chromium, 32 in WebKit and 32 in Firefox. Automated accessibility scans report no A/AA violations in the passing reviewed screens. Additional assertions cover keyboard return, focus visibility, collection/group semantics, stable notification geometry, textarea/footer scroll ownership, minimum target sizes and contrast. The palette check evaluates 280 pairs: seven themes × two modes × twenty text/control pairings. Normal motion is tested separately from the default reduced-motion browser context. HTTP upload-fixture teardown closes its browser context before draining the server, releasing Chromium's speculative connections; three complete cold upload/cleanup cycles for each of Fluo, Ligo and Rondo passed (9/9, 45.6s, zero retries).

The four live checks cover remembered sessions and logout, native credential-theme behavior, OTP error styling, and the complete registration/TOTP/recovery/SSO product journey. That journey submits actual Fluo/Ligo/Rondo media, exercises LiveKit camera behavior, and creates a Lingvo dictionary/card before checking persisted review and undo state. The account lookup diagnostic measured p95 11ms across 32 concurrent requests in this local run; it is a diagnostic sample, not a production latency claim.

## Evidence boundaries

This audit establishes the behavior of the reviewed implementation in the recorded contexts. It does not claim that every possible browser/device/data combination is bug free, that axe proves all WCAG criteria, or that simulated touch input replaces a real-device study. UEQ/VisAWI participant results and ISO task-time/satisfaction measurements remain unmeasured. These are boundaries of the evidence, not results invented to reach the numerical target.

The baseline's existing browser suite passed 12 scenarios but omitted Lingvo and several authenticated dialogs, text-resize, touch and focus cases. No complete numerical baseline was measured, so no fabricated before/after score is reported.

The artifact layer builds all six static applications and the public scenarios inspect those outputs. Authenticated UI fixtures use isolated Vite servers; the native identity/live-product suite uses the existing local development stack. This audit does not replace the complete static-artifact integration gate or a hosted GitHub Actions run. Workflow files were not changed, and historical CI durations are not presented as measurements of this working tree.
