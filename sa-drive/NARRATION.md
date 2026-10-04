# Story narration

Pre-recorded voice lines that play at fixed points in a run. They're made once
on the ElevenLabs website - no API key, and nothing calls ElevenLabs while
playing.

## Making the clips

1. elevenlabs.io -> ElevenCreative -> **Text to Speech**.
2. Pick one voice and use it for every line.
3. Paste a line from the table, **Generate**, then **Download**.
4. Rename the file to the name in the table and put it in `public/audio/story/`.
5. Commit and push - Vercel serves the clips with the game.

`.mp3` or `.m4a` both work. Add them one at a time: a missing clip is skipped
(its caption still shows), so nothing breaks while the set is incomplete.

| File | Plays when | Line |
| --- | --- | --- |
| `intro.mp3` | The drive starts (Start / Use Keyboard) | Crew, this is your handler. Three vaults, one night in San Antonio. Grab the loot, stay ahead of the cops, and don't get caught. First stop: the Alamo. |
| `alamo-arrive.mp3` | Car reaches stop 1, the Alamo | You're at the Alamo. The vault's rigged to the old mission's security grid. Hacker, you're up. Remember the sequence, and keep that sensor in the dark. |
| `alamo-done.mp3` | Alamo vault cleared | Alamo vault's open. Nice work. Next stop: the River Walk. Watch your mirrors; they know we're out here. |
| `riverwalk-arrive.mp3` | Car reaches stop 2, the River Walk | River Walk checkpoint. The guard's camera reads faces. Read the clue, play it cool, and give him exactly what he wants. |
| `riverwalk-done.mp3` | River Walk vault cleared | You fooled the guard. Cash secured. One more: the Tower of the Americas. Get there fast. |
| `tower-arrive.mp3` | Car reaches stop 3, the Tower | Tower of the Americas. Last vault. Call the bank, talk your way past Margaret, and punch in the code before the trace finishes. |
| `tower-done.mp3` | Tower vault cleared (finale) | That's all three vaults. San Antonio never saw it coming. Now drive. Get the crew home. |
| `caught.mp3` | Police catch you | They've got you. Heist's over, crew. Lay low and try again. |
| `alarm.mp3` | A challenge alarm trips | Alarm's tripped! Every cop in the city just heard that. Move! |

To change a line, edit `src/config/storyLines.js` (it's also the on-screen
caption) and regenerate that clip. Each line plays once per run; a restart (R)
starts the story over. The chase music dips while the narrator talks, and the
Sound on/off button mutes the narrator too.
