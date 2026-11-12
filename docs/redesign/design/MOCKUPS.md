# Reading the mockups

The live canvas, the best way to look at them: https://claude.ai/artifact/SL537jiSmjxD3svbH1Ew8W

The `.dc.html` files here are the canvas sources. They are templates for the design tool's runtime, so opening them directly in a browser will **not** render the lists. Read them as source: every color, size, radius, shadow and string in them is final.

Template syntax you'll see:

- `{{name}}` is a value filled in from the `renderVals()` script at the bottom of each file.
- `<sc-for list="{{tiles}}" as="t">…</sc-for>` repeats its children once per item.
- `<sc-if value="{{t.blank}}">…</sc-if>` renders its children only when the value is true.
- `<helmet>` holds the page's font `<link>` and base CSS.
- Styles are inline on purpose (the design tool edits them). In the real code, move them into `style.css` using `design/tokens.css`.

The script blocks hold the real sample data: the board `7586ac3f0b1294ed` (par 48), its optimal solution, the solver paused at move 18, and leaderboard rows whose scores come from the scoring formula.

| File | Size | Screen |
|---|---|---|
| `Main.dc.html` | 1280×820, fluid | Desktop: Daily, board revealed |
| `Desktop-Solved.dc.html` | 1280×820, fluid | Desktop: solved |
| `Desktop-Share.dc.html` | 1280×820, fluid | Desktop: share dialog |
| `Desktop-Solver.dc.html` | 1280×820, fluid | Desktop: solver playback |
| `Desktop-Leaderboard.dc.html` | 1280×820, fluid | Desktop: leaderboard and scoring explainer |
| `Mobile-Start.dc.html` | 390×844 | Phone: Daily, board revealed |
| `Mobile-Solved.dc.html` | 390×844 | Phone: solved |
| `Mobile-Share.dc.html` | 390×844 | Phone: share sheet |
| `Mobile-Solver.dc.html` | 390×844 | Phone: solver |
| `Mobile-Leaderboard.dc.html` | 390×844 | Phone: leaderboard |

Not mocked; build them in the same style: the Start overlay, the Paused cover, the shortcut help (`?`), the Free play header with a New game button, the "No daily today" state, toasts, and the handle editor.
