# Real-footage demonstration — 26 October 2026

`output/MatchForEveryFan_RealFootage_Demo.mp4` is an actual **66-second, 1280×720, 24 fps H.264/AAC** product-output sample, generated locally. It is an annotated video export, not a screen recording and not a live-broadcast integration. It contains real football footage, a tactical freeze frame, a large goal overlay, three commentary styles and locally generated English voice segments.

## Watch / interact

- Open the MP4 directly, or http://127.0.0.1:3007/demo-video while the V4.1 local server runs. This is an older exported video, separate from V4.1's live viewer.
- In Matchroom, the new top buttons **Real footage · Tactical frame** and **Real footage · Goal** open the actual clips.
- Tactical frame opens at 6.000 seconds, paused: cyan selected defending group, orange selected attacking group, fifteen visible-player foot markers. It is a manual snapshot, not a complete defensive/forward line, an offside judgement, a midfield line or continuous tracking.
- Goal clip starts at 17 seconds, shortly before the manually reviewed shot/goal. Select Emotion and Play, or select the goal moment; a large GOOOOAL appears over the actual picture. No full match score is fabricated.
- Select **Hear this perspective** to enable Both and read the current local commentary through browser speech. System voices depend on the browser/device.

## MP4 contents

0–4 introduction; 4–10 actual corner playback; 10–20 manually annotated freeze frame; 20–24 playback resumes; 24–26 transition; 26–35 real goal with large Emotion caption; 35–44 same sequence in Tactical; 44–53 same sequence in Casual; 53–60 presentation choices; 60–66 credits.

The speech is Windows system voice reading prepared local text, with different wording/rates. It is not a real Foundry/model API call. The three-second goal voice is aligned to the editorial goal-caption onset at 31.8 seconds in the export. No soundtrack or guessed crowd/whistle sound labels are added. Original clip audio is omitted.

## Rebuild on this Windows computer

```powershell
.\.venv\Scripts\python.exe scripts/download_sample.py
.\.venv\Scripts\python.exe scripts/download_tactical_clip.py
.\.venv\Scripts\python.exe scripts/export_real_demo.py
```

Additional export dependencies are in `requirements-export.txt`. Standard application playback does not require them. The exporter reads the same sample annotation JSON used by the browser. Windows speech can require permission to invoke the system voice service; without it the script exports captions only. `--audio-only` regenerates narration and remuxes an existing `input/export_work/render-silent.mp4`.

## Footage credits / adapted video license

1. **NaBUru38**, *2018 FIFA U-17 Women's World Cup – New Zealand vs Canada – 22*, filmed 1 December 2018. Source: https://commons.wikimedia.org/wiki/File:2018_FIFA_U-17_Women%27s_World_Cup_-_New_Zealand_vs_Canada_-_22.webm . CC BY-SA 4.0. Original SHA-1 `50032c2533f41b08107c22383f03669860a124d5` verified locally.
2. **Maximilian Schönherr**, *Amateurfußball Torschuss von oben*, filmed 5 February 2022. Source: https://commons.wikimedia.org/wiki/File:Amateurfu%C3%9Fball_Torschuss_von_oben.webm . CC BY-SA 4.0. Original SHA-1 `0b2eb0e6537ac8af748ae88b7eeaaeac39cd43d5` verified locally.

License: https://creativecommons.org/licenses/by-sa/4.0/ . Changes: excerpt sequencing, freeze frame, manual foot-position/group overlays, event/style captions, local system speech, title/credit cards. Adapted video and annotation contributions are provided under **CC BY-SA 4.0**. No endorsement by the original filmmakers is implied. Keep these source and license links with any distributed copy; footage is excluded from the source test ZIP. Source software licensing is separate.

## Competition use

This is an older exported product sample, not the final competition screen recording. V4.1 separately offers sampled-frame scene descriptions and live calls using the team's configured Microsoft Foundry image model; that route requires the owner's endpoint and key. Full-team formation detection and automatic broadcast-source access remain unimplemented. The final submission video should show the actual V4.1 app operating on its target device and credit any footage shown.
