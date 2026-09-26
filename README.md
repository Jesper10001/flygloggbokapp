# Blades — projektöversikt

Det här är rot-mappen för hela Blades. Den innehåller **tre delar som körs** + ett **arkiv** med gamla designunderlag.

## Toppnivå — vad ligger var?

| Mapp | Vad det är | Körs var |
|---|---|---|
| **`FlightLogApp/`** | Själva **appen** (React Native / Expo, iOS). All kod för skärmar, databas, logik. | På telefonen (EAS-build + `expo start`) |
| **`proxy/`** | **Cloudflare Worker** — API-proxy mellan appen och AI:n. Håller API-nyckeln, kvoter (Blade-coins), promo-koder och serverar Privacy/Terms. | Cloudflare (`wrangler deploy`) |
| **`website/`** | **Marknadsföringssajten** (blades-app.com) + Privacy/Terms-sidor. | Cloudflare Pages (`wrangler pages deploy website`) |
| **`archive/`** | **Gamla designunderlag** (zip-leveranser + `design_handoff_*`). Bara referens — används inte av bygget. | — |

> **Börja här:** en detaljerad karta över appens interna mappar finns i **[`FlightLogApp/STRUKTUR.md`](FlightLogApp/STRUKTUR.md)**.

## Vanliga kommandon

```bash
# Appen (iteration i dev-klienten, ren JS)
cd FlightLogApp && npx expo start --dev-client
cd FlightLogApp && npx tsc --noEmit          # typkontroll

# Native ombyggnad (krävs bara vid nya native-moduler)
cd FlightLogApp && npx eas-cli build --profile development --platform ios

# Proxy (Cloudflare Worker)
cd proxy && npx wrangler deploy

# Sajten (Cloudflare Pages)
cd /Users/jespertoreld/Developer/flygloggbokapp && npx wrangler pages deploy website --project-name blades-website
```

## Bra att veta

- **Hemligheter** ligger i `FlightLogApp/.env` (proxy-URL + nyckel) — medvetet utanför git. Backa upp separat.
- **`archive/`** kan tryggt ignoreras vid utveckling; inget där importeras av appen.
- Appens interna delar (`app/`, `components/`, `services/`, `db/`, `store/` …) beskrivs i [`FlightLogApp/STRUKTUR.md`](FlightLogApp/STRUKTUR.md).
