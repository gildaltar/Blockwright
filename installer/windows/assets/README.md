# Windows release artwork

The installer payload uses `assets/github/blockwright-icon-v060.png` as the Control Center window icon. Keep that original transparent square PNG unchanged and copy it into the staged package as `assets/blockwright-icon-v060.png`.

`installer/windows/assets/blockwright-v060.ico` is the reviewed multi-resolution Windows export of that source mark (16, 24, 32, 48, 64, 128, and 256 px). Inno Setup uses it for the setup executable. Regenerate it only from the unchanged source artwork, visually inspect the small sizes, and never substitute a renamed or placeholder file.

The wide source artwork is `assets/github/blockwright-hero-v060.png`; use it for release pages and store imagery, not as an installer executable icon.
