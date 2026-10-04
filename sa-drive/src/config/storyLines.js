// Story narration: one pre-recorded clip per moment, generated once on the
// ElevenLabs website (Text to Speech -> Download) - no API calls in the game.
// Put each download in public/audio/story/ named <id>.mp3 (or .m4a).
// The text doubles as the on-screen caption, and as the script to paste into
// ElevenLabs. A clip that's missing is skipped (the caption still shows).
export const STORY_LINES = {
  intro:
    "Crew, this is your handler. Three vaults, one night in San Antonio. Grab the loot, stay ahead of the cops, and don't get caught. First stop: the Alamo.",
  'alamo-arrive':
    "You're at the Alamo. The vault's rigged to the old mission's security grid. Hacker, you're up. Remember the sequence, and keep that sensor in the dark.",
  'alamo-done':
    "Alamo vault's open. Nice work. Next stop: the River Walk. Watch your mirrors; they know we're out here.",
  'riverwalk-arrive':
    "River Walk checkpoint. The guard's camera reads faces. Read the clue, play it cool, and give him exactly what he wants.",
  'riverwalk-done':
    'You fooled the guard. Cash secured. One more: the Tower of the Americas. Get there fast.',
  'tower-arrive':
    'Tower of the Americas. Last vault. Call the bank, talk your way past Margaret, and punch in the code before the trace finishes.',
  'tower-done':
    "That's all three vaults. San Antonio never saw it coming. Now drive. Get the crew home.",
  caught: "They've got you. Heist's over, crew. Lay low and try again.",
  alarm: "Alarm's tripped! Every cop in the city just heard that. Move!",
};

export const STORY_AUDIO_DIR = '/audio/story';
export const STORY_AUDIO_EXTENSIONS = ['mp3', 'm4a'];
// Chase music volume multiplier while the narrator is talking.
export const NARRATION_MUSIC_DUCK = 0.25;
// "Reach" lines start this many meters before a stop's challenge trigger zone,
// for the stop the route is currently heading to (clips run ~10 s).
export const APPROACH_LEAD_M = 150;
// The recorded clips may not match this text word for word, so while a clip is
// playing only a small "HANDLER" badge shows; the full text shows when a clip is
// missing. Set true to always show the text as subtitles.
export const SHOW_TEXT_WITH_AUDIO = false;
