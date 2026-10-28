# Match for Every Fan — Demo V5

A simple football match viewer with accessible AI scene descriptions or live calls. V5 adds a viewer-triggered recap.

## Start

Double-click `START_DEMO_V5_AI.cmd`. Enter your Microsoft Foundry resource endpoint, image deployment name (for example `gpt-4o`), and API key in the local terminal. The key is masked and is not saved. Open http://127.0.0.1:3008 and check the **DEMO V5** label. Keep the terminal open. `START_DEMO_V5_LOCAL.cmd` previews the page without Azure.

Choose the recorded sample, your own permitted clip, or a match window. Turn on AI mode; choose **Describe play** or **Live call**, a tone, and optional speech. For a recap, leave AI mode on and click **Summarize this segment** after at least one AI line. Playback pauses for the recap and resumes when you click Continue watching. If speech is enabled, the recap is read aloud. The app sends previous AI lines for recap, not another image.

The recap labels how many previous AI lines it used; it cannot know what happened between picture checks. The three-recap cap and 36-picture cap are local cost limits, not Azure quota. Without a viewer-confirmed cue, the app avoids claiming a goal or player name based on a picture alone.

## Check

`npm test`; `npm run smoke`; `node scripts/browser_mode_qa.mjs --mock-cloud --mock-speech`. The browser check uses simulated cloud responses and does not call Azure.

See `ASSET_CREDITS_V4_1.md` for the sample video and event-demo credits. The older V4.1 is preserved separately.
