# Skills Desktop feature map

Verification source for the packaged Electron workspace. V1 is Local-only.
Drive the real window over CDP (`helpers/drive.mjs`). Do not treat
`prototype/` or unit tests as a user-facing proof.

| Feature | User entry | Proof in one line |
| --- | --- | --- |
| [Inventory](inventory.md) | Primary **Inventory** (default) | Fresh table shows fixture skills; inspector matches the clicked row; Refresh records `npx skills list`. |
| [Targets](targets.md) | Primary **Targets** | A new Local Target appears in the list and rail after **Save Target**. |
| [Comparison](comparison.md) | Primary **Comparison** | Two Local Targets produce an aligned table after **Compare**. |
| [Collections](collections.md) | Primary **Collections** | Bundled **Skills Desktop Starter** assesses Local Targets; **Prepare plan** shows a Collection Plan. |
| [About](about.md) | Primary **About** | Product name, version `0.1.0`, and **Manual upgrade** for unsigned/preview policy. |

Trusted Review is not a sidebar page. It is opened from Inventory or
Collections after a Command Plan / Collection Plan exists. See Inventory
sub-features and Collections sub-features.

SSH chrome (`SSH · 未在 V1 开放`, `aria-label="SSH 未开放"`) is a closed
V1 door. A proof that it stays disabled is valid; a proof that tries to
create or mutate an SSH Target is out of scope.
