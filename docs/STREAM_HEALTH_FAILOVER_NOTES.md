# Stream Failover Safety Loop Notes

- Safety-loop assets live in `/srv/media/safety_loop` on the media volume. Provide ≥60–120 s material with clean loop points and match the main stream format (44.1 kHz, stereo, 256 kbps MP3).
- Normalize audio to roughly **-16 LUFS** before deploying; the Liquidsoap patch assumes pre-normalized content and only applies a light ramp (`fade.in/out`).
- The playlist is served with `mode="random"` and `reload_mode="watch"`, so dropping new files or updating content takes effect without restarting Liquidsoap.
- If the directory is missing or empty, the watchdog logs `FAILOVER_DISABLED` and will not attempt graceful failover.
- Telnet/JSON-RPC controls are bound to `127.0.0.1`; credentials are stored alongside other LibreTime secrets in `config.yml` / docker `.env`.
- Environment knobs:
  - `LS_FAILOVER_ENABLED` – master toggle (default `true`)
  - `LS_RECOVER_TIMEOUT_SEC` – watchdog wait before escalating (default `30`)
  - `FAILOVER_MIN_STAY_SEC` – minimum time on the safety loop before probing main (default `10`)
  - `RESTART_COOLDOWN_MIN` – Liquidsoap soft restart backoff (default `10`)
- The Liquidsoap patch lives at `/srv/libretime/patches/liquidsoap/ls_script.liq` and is volume-mounted into both `playout` and `liquidsoap` containers; update via git, then recreate containers.

