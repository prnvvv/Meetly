# Self-hosted TURN (coturn)

1. `openssl rand -base64 32` -> put it in `turnserver.conf` as `static-auth-secret` AND in the API env as `TURN_SHARED_SECRET`.
2. Fill `external-ip` and `realm` in `turnserver.conf`.
3. Open on the host firewall: UDP+TCP 3478, UDP 49160-49200.
4. `docker compose up -d`
5. API env: `TURN_URLS=turn:<PUBLIC_IP_OR_DOMAIN>:3478?transport=udp,turn:<PUBLIC_IP_OR_DOMAIN>:3478?transport=tcp` and `TURN_SHARED_SECRET=<secret>`; redeploy.
6. Verify: see docs/deployment/TURN_COTURN.md ("How to PROVE it works").
