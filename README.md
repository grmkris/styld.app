# Styld v2

Styld rewritten on Effect, Foldkit and Cloudflare. It ports the v1 behaviour worth keeping (`docs/ROADMAP.md`), runs
on an isolated `workers.dev` preview for two testers, and is not yet released to production; v1 and its data stay
untouched.

- [Status](docs/STATUS.md): the release on the preview, the gates, what is built, open items
- [Delivery map](docs/DELIVERY.md): each kept feature and the tests and readbacks that prove it
- [Architecture](docs/ARCHITECTURE.md): the decisions in force
- [Roadmap](docs/ROADMAP.md): remaining scope
- [Handoff](docs/HANDOFF.md) and [Deployment](docs/DEPLOYMENT.md): how to resume, deploy, rebuild and import
- [Testing guide](docs/TESTING-GUIDE.md): what the testers try and how to report a problem
- [Agent instructions](AGENTS.md): workflow, commands and the workspace map

```sh
bun install --frozen-lockfile
heavy --wait bun run check   # every gate CI runs
```

Cloudflare resource names are prefixed `styldappv2`; no production domain is attached.
