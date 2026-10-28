---
name: inbox
description: Hämta och gör uppgifterna som användaren skrivit på driftsidan Blades Ops (api.blades-app.com/ops). Använd när användaren skriver /inbox eller ber dig kolla uppgifterna från driftsidan.
---

# Uppgifter från Blades Ops

Användaren skriver uppgifter till dig i rutan "Uppgifter till Claude" på driftsidan. SessionStart-hooken visar dem när en session startar; den här skillen hämtar dem mitt i en session.

1. Kör `bash scripts/ops-inbox.sh` från repots rot. Skriptet skriver ut varje öppen uppgift som `[id] datum: text`. Skriver det ingenting är inkorgen tom (eller token saknas): säg det kort och sluta.
2. Gör uppgifterna som om användaren skrivit dem i chatten. Samma regler gäller som annars: ingen commit eller deploy utan användarens OK, och fråga om något är oklart innan du gissar.
3. Bocka av varje klar uppgift med `bash scripts/ops-inbox.sh done <id> "notering"`. Noteringen visas på sidan i telefonen. Skriv den på svenska, i en eller två meningar om vad som ändrades och vad som eventuellt återstår.
4. Kräver något användaren (deploy, nycklar, App Store Connect, ett beslut): `bash scripts/ops-inbox.sh ask "vad som ska göras"`. Det hamnar under "Till dig, från Claude" på sidan.
5. Avsluta med en kort sammanfattning i chatten av vad som gjordes per uppgift.

Token ligger i `~/.config/blades-ops/token`. Visa den aldrig, skriv aldrig ut filen och lägg den aldrig i kod, chatt eller instruktioner till andra.
