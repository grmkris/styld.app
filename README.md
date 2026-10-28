# Styld v2

The full Styld migration to Effect, Foldkit and Cloudflare. Implementation is in progress; this repository is not yet feature-complete or ready for acceptance.

The user-authorized target is feature parity with the frozen Styld v1 baseline, deployed on an isolated `workers.dev` URL, with native runtime tests and multiple final architecture/behavior reviews.

- [Delivery plan](docs/DELIVERY.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Parity baseline](docs/migration/v1-inventory.json)
- [Progress and evidence](docs/STATUS.md)

The existing Railway application and its data remain untouched. Cloudflare resource identities are prefixed `styldappv2`; no production domain cutover is part of preview delivery.
