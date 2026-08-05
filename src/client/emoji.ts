/**
 * A curated emoji catalog. Keeping it in-repo means the picker, the shortcode
 * renderer and reactions all agree, with no runtime download and no dependency.
 */

export type EmojiCategory = {
  id: string;
  label: string;
  emoji: Array<[name: string, char: string, keywords?: string]>;
};

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "people",
    label: "Smileys & people",
    emoji: [
      ["grinning", "😀", "smile happy"],
      ["smiley", "😃", "happy joy"],
      ["smile", "😄", "happy joy laugh"],
      ["grin", "😁", "happy"],
      ["laughing", "😆", "haha lol"],
      ["sweat_smile", "😅", "hot nervous"],
      ["joy", "😂", "lol crying laughing"],
      ["rofl", "🤣", "lol rolling"],
      ["relaxed", "☺️", "happy"],
      ["blush", "😊", "shy happy"],
      ["innocent", "😇", "angel"],
      ["slightly_smiling_face", "🙂", "smile"],
      ["upside_down_face", "🙃", "sarcasm"],
      ["wink", "😉", "flirt"],
      ["relieved", "😌", "phew"],
      ["heart_eyes", "😍", "love crush"],
      ["kissing_heart", "😘", "kiss love"],
      ["yum", "😋", "tasty delicious"],
      ["stuck_out_tongue_winking_eye", "😜", "silly"],
      ["zany_face", "🤪", "crazy silly"],
      ["nerd_face", "🤓", "smart glasses"],
      ["sunglasses", "😎", "cool"],
      ["partying_face", "🥳", "celebrate party"],
      ["thinking_face", "🤔", "hmm think"],
      ["zipper_mouth_face", "🤐", "quiet secret"],
      ["neutral_face", "😐", "meh"],
      ["expressionless", "😑", "blank"],
      ["no_mouth", "😶", "silence"],
      ["smirk", "😏", "smug"],
      ["unamused", "😒", "annoyed"],
      ["roll_eyes", "🙄", "whatever"],
      ["grimacing", "😬", "awkward yikes"],
      ["lying_face", "🤥", "pinocchio"],
      ["pensive", "😔", "sad"],
      ["sleepy", "😪", "tired"],
      ["sleeping", "😴", "zzz"],
      ["mask", "😷", "sick"],
      ["face_with_thermometer", "🤒", "sick fever"],
      ["nauseated_face", "🤢", "sick gross"],
      ["sneezing_face", "🤧", "sick"],
      ["hot_face", "🥵", "heat"],
      ["cold_face", "🥶", "freezing"],
      ["exploding_head", "🤯", "mind blown"],
      ["cowboy_hat_face", "🤠", "yeehaw"],
      ["confused", "😕", "unsure"],
      ["worried", "😟", "concern"],
      ["slightly_frowning_face", "🙁", "sad"],
      ["cry", "😢", "sad tear"],
      ["sob", "😭", "crying"],
      ["scream", "😱", "shock fear"],
      ["confounded", "😖", "frustrated"],
      ["persevere", "😣", "struggle"],
      ["disappointed", "😞", "sad"],
      ["sweat", "😓", "stress"],
      ["weary", "😩", "tired"],
      ["tired_face", "😫", "exhausted"],
      ["triumph", "😤", "determined"],
      ["rage", "😡", "angry mad"],
      ["angry", "😠", "mad"],
      ["face_with_symbols_on_mouth", "🤬", "cursing"],
      ["smiling_imp", "😈", "devil"],
      ["skull", "💀", "dead"],
      ["ghost", "👻", "spooky"],
      ["alien", "👽", "ufo"],
      ["robot", "🤖", "bot"],
      ["poop", "💩", "poo"],
      ["wave", "👋", "hello bye"],
      ["raised_hands", "🙌", "celebrate praise"],
      ["clap", "👏", "applause"],
      ["+1", "👍", "thumbsup yes like"],
      ["-1", "👎", "thumbsdown no"],
      ["ok_hand", "👌", "perfect"],
      ["punch", "👊", "fist bump"],
      ["fist", "✊", "power"],
      ["v", "✌️", "peace"],
      ["crossed_fingers", "🤞", "luck hope"],
      ["handshake", "🤝", "deal agree"],
      ["pray", "🙏", "thanks please"],
      ["muscle", "💪", "strong"],
      ["point_up", "☝️", "this"],
      ["point_right", "👉", "that"],
      ["eyes", "👀", "look watching"],
      ["brain", "🧠", "smart"],
      ["person_raising_hand", "🙋", "question volunteer"],
      ["shrug", "🤷", "idk"],
      ["facepalm", "🤦", "ugh"],
      ["dancer", "💃", "dance party"],
      ["technologist", "🧑‍💻", "developer coding"],
      ["detective", "🕵️", "investigate"]
    ]
  },
  {
    id: "nature",
    label: "Animals & nature",
    emoji: [
      ["dog", "🐶", "puppy"],
      ["cat", "🐱", "kitten"],
      ["mouse", "🐭", ""],
      ["hamster", "🐹", ""],
      ["rabbit", "🐰", "bunny"],
      ["fox_face", "🦊", ""],
      ["bear", "🐻", ""],
      ["panda_face", "🐼", ""],
      ["koala", "🐨", ""],
      ["tiger", "🐯", ""],
      ["lion", "🦁", ""],
      ["cow", "🐮", ""],
      ["pig", "🐷", ""],
      ["frog", "🐸", ""],
      ["monkey_face", "🐵", ""],
      ["see_no_evil", "🙈", "monkey"],
      ["hear_no_evil", "🙉", "monkey"],
      ["speak_no_evil", "🙊", "monkey"],
      ["penguin", "🐧", ""],
      ["bird", "🐦", ""],
      ["duck", "🦆", ""],
      ["eagle", "🦅", ""],
      ["owl", "🦉", ""],
      ["bat", "🦇", ""],
      ["wolf", "🐺", ""],
      ["unicorn", "🦄", "magic"],
      ["bee", "🐝", ""],
      ["bug", "🐛", "issue"],
      ["butterfly", "🦋", ""],
      ["snail", "🐌", "slow"],
      ["turtle", "🐢", "slow"],
      ["snake", "🐍", ""],
      ["octopus", "🐙", ""],
      ["fish", "🐟", ""],
      ["dolphin", "🐬", ""],
      ["whale", "🐳", ""],
      ["rocket", "🚀", "launch ship deploy"],
      ["seedling", "🌱", "grow"],
      ["evergreen_tree", "🌲", ""],
      ["palm_tree", "🌴", ""],
      ["cactus", "🌵", ""],
      ["four_leaf_clover", "🍀", "luck"],
      ["maple_leaf", "🍁", "autumn"],
      ["mushroom", "🍄", ""],
      ["bouquet", "💐", "flowers"],
      ["rose", "🌹", ""],
      ["sunflower", "🌻", ""],
      ["sun_with_face", "🌞", ""],
      ["full_moon", "🌕", ""],
      ["crescent_moon", "🌙", ""],
      ["star", "⭐", "favorite"],
      ["star2", "🌟", "sparkle"],
      ["sparkles", "✨", "magic new"],
      ["zap", "⚡", "fast lightning"],
      ["fire", "🔥", "lit hot"],
      ["boom", "💥", "explosion"],
      ["snowflake", "❄️", "cold"],
      ["rainbow", "🌈", "pride"],
      ["ocean", "🌊", "wave"],
      ["cloud", "☁️", ""],
      ["sunny", "☀️", ""]
    ]
  },
  {
    id: "food",
    label: "Food & drink",
    emoji: [
      ["green_apple", "🍏", ""],
      ["apple", "🍎", ""],
      ["banana", "🍌", ""],
      ["watermelon", "🍉", ""],
      ["grapes", "🍇", ""],
      ["strawberry", "🍓", ""],
      ["peach", "🍑", ""],
      ["pineapple", "🍍", ""],
      ["avocado", "🥑", ""],
      ["bread", "🍞", ""],
      ["croissant", "🥐", ""],
      ["cheese", "🧀", ""],
      ["bacon", "🥓", ""],
      ["hamburger", "🍔", "burger"],
      ["fries", "🍟", ""],
      ["pizza", "🍕", ""],
      ["hotdog", "🌭", ""],
      ["taco", "🌮", ""],
      ["burrito", "🌯", ""],
      ["ramen", "🍜", "noodles"],
      ["spaghetti", "🍝", "pasta"],
      ["sushi", "🍣", ""],
      ["bento", "🍱", ""],
      ["rice", "🍚", ""],
      ["curry", "🍛", ""],
      ["popcorn", "🍿", ""],
      ["doughnut", "🍩", "donut"],
      ["cookie", "🍪", ""],
      ["cake", "🍰", "dessert"],
      ["birthday", "🎂", "cake celebrate"],
      ["chocolate_bar", "🍫", ""],
      ["candy", "🍬", ""],
      ["honey_pot", "🍯", ""],
      ["coffee", "☕", "espresso"],
      ["tea", "🍵", ""],
      ["beer", "🍺", ""],
      ["beers", "🍻", "cheers"],
      ["wine_glass", "🍷", ""],
      ["cocktail", "🍸", ""],
      ["tropical_drink", "🍹", ""],
      ["champagne", "🍾", "celebrate"],
      ["clinking_glasses", "🥂", "cheers"],
      ["tumbler_glass", "🥃", "whiskey"],
      ["milk_glass", "🥛", ""],
      ["ice_cube", "🧊", ""]
    ]
  },
  {
    id: "activity",
    label: "Activity",
    emoji: [
      ["soccer", "⚽", "football"],
      ["basketball", "🏀", ""],
      ["football", "🏈", ""],
      ["baseball", "⚾", ""],
      ["tennis", "🎾", ""],
      ["volleyball", "🏐", ""],
      ["8ball", "🎱", "pool"],
      ["ping_pong", "🏓", ""],
      ["badminton", "🏸", ""],
      ["goal_net", "🥅", ""],
      ["golf", "⛳", ""],
      ["ski", "🎿", ""],
      ["snowboarder", "🏂", ""],
      ["surfer", "🏄", ""],
      ["swimmer", "🏊", ""],
      ["bicyclist", "🚴", ""],
      ["mountain_biking", "🚵", ""],
      ["running", "🏃", ""],
      ["weight_lifting", "🏋️", "gym"],
      ["trophy", "🏆", "win"],
      ["first_place_medal", "🥇", "gold win"],
      ["medal_sports", "🏅", ""],
      ["dart", "🎯", "target goal"],
      ["video_game", "🎮", "gaming"],
      ["game_die", "🎲", "random"],
      ["jigsaw", "🧩", "puzzle"],
      ["performing_arts", "🎭", ""],
      ["art", "🎨", "design"],
      ["musical_note", "🎵", ""],
      ["guitar", "🎸", ""],
      ["headphones", "🎧", "music"],
      ["microphone", "🎤", "sing"],
      ["clapper", "🎬", "film"],
      ["tada", "🎉", "party celebrate ship"],
      ["confetti_ball", "🎊", "party"],
      ["balloon", "🎈", "party"],
      ["gift", "🎁", "present"]
    ]
  },
  {
    id: "objects",
    label: "Objects",
    emoji: [
      ["computer", "💻", "laptop"],
      ["desktop_computer", "🖥️", ""],
      ["keyboard", "⌨️", ""],
      ["iphone", "📱", "mobile"],
      ["floppy_disk", "💾", "save"],
      ["cd", "💿", ""],
      ["camera", "📷", "photo"],
      ["video_camera", "📹", ""],
      ["telephone", "☎️", "call"],
      ["battery", "🔋", ""],
      ["electric_plug", "🔌", ""],
      ["bulb", "💡", "idea"],
      ["flashlight", "🔦", ""],
      ["mag", "🔍", "search"],
      ["lock", "🔒", "secure"],
      ["unlock", "🔓", ""],
      ["key", "🔑", "access"],
      ["hammer", "🔨", "build fix"],
      ["wrench", "🔧", "tools fix"],
      ["nut_and_bolt", "🔩", ""],
      ["gear", "⚙️", "settings"],
      ["link", "🔗", "url"],
      ["paperclip", "📎", "attach"],
      ["pushpin", "📌", "pin"],
      ["scissors", "✂️", "cut"],
      ["pencil2", "✏️", "write edit"],
      ["memo", "📝", "note docs"],
      ["book", "📖", "read docs"],
      ["books", "📚", "library"],
      ["newspaper", "📰", "news"],
      ["clipboard", "📋", "tasks"],
      ["calendar", "📅", "date"],
      ["chart_with_upwards_trend", "📈", "growth metrics"],
      ["chart_with_downwards_trend", "📉", "decline"],
      ["bar_chart", "📊", "analytics"],
      ["file_folder", "📁", "files"],
      ["package", "📦", "shipping release"],
      ["envelope", "✉️", "email"],
      ["mailbox", "📬", "inbox"],
      ["bell", "🔔", "notification"],
      ["no_bell", "🔕", "mute"],
      ["hourglass", "⌛", "waiting"],
      ["alarm_clock", "⏰", "reminder"],
      ["stopwatch", "⏱️", "timing"],
      ["watch", "⌚", "time"],
      ["money_with_wings", "💸", "spend"],
      ["moneybag", "💰", "budget"],
      ["credit_card", "💳", "payment"],
      ["gem", "💎", "valuable"],
      ["crown", "👑", "king queen"],
      ["coffin", "⚰️", ""],
      ["shopping_cart", "🛒", ""],
      ["broom", "🧹", "cleanup"],
      ["magnet", "🧲", ""],
      ["test_tube", "🧪", "experiment"],
      ["dna", "🧬", ""],
      ["pill", "💊", ""],
      ["bandage", "🩹", "fix patch"],
      ["toolbox", "🧰", ""],
      ["shield", "🛡️", "security"]
    ]
  },
  {
    id: "travel",
    label: "Travel & places",
    emoji: [
      ["car", "🚗", ""],
      ["taxi", "🚕", ""],
      ["bus", "🚌", ""],
      ["ambulance", "🚑", "urgent"],
      ["fire_engine", "🚒", "incident"],
      ["police_car", "🚓", ""],
      ["truck", "🚚", "delivery"],
      ["tractor", "🚜", ""],
      ["bike", "🚲", ""],
      ["motorcycle", "🏍️", ""],
      ["airplane", "✈️", "flight"],
      ["helicopter", "🚁", ""],
      ["ship", "🚢", ""],
      ["sailboat", "⛵", ""],
      ["train", "🚆", ""],
      ["metro", "🚇", "subway"],
      ["house", "🏠", "home"],
      ["office", "🏢", "work"],
      ["hospital", "🏥", ""],
      ["bank", "🏦", ""],
      ["hotel", "🏨", ""],
      ["school", "🏫", ""],
      ["factory", "🏭", ""],
      ["statue_of_liberty", "🗽", ""],
      ["tokyo_tower", "🗼", ""],
      ["mount_fuji", "🗻", ""],
      ["camping", "🏕️", ""],
      ["beach_umbrella", "🏖️", "vacation ooo"],
      ["desert_island", "🏝️", "vacation"],
      ["national_park", "🏞️", ""],
      ["earth_americas", "🌎", "world"],
      ["earth_africa", "🌍", "world"],
      ["earth_asia", "🌏", "world"],
      ["milky_way", "🌌", ""],
      ["city_sunset", "🌆", ""]
    ]
  },
  {
    id: "symbols",
    label: "Symbols",
    emoji: [
      ["heart", "❤️", "love"],
      ["orange_heart", "🧡", ""],
      ["yellow_heart", "💛", ""],
      ["green_heart", "💚", ""],
      ["blue_heart", "💙", ""],
      ["purple_heart", "💜", ""],
      ["black_heart", "🖤", ""],
      ["broken_heart", "💔", ""],
      ["100", "💯", "perfect score"],
      ["white_check_mark", "✅", "done complete yes"],
      ["heavy_check_mark", "✔️", "done"],
      ["ballot_box_with_check", "☑️", "checkbox"],
      ["x", "❌", "no wrong"],
      ["negative_squared_cross_mark", "❎", ""],
      ["warning", "⚠️", "caution"],
      ["no_entry", "⛔", "blocked"],
      ["question", "❓", "help"],
      ["exclamation", "❗", "important"],
      ["heavy_plus_sign", "➕", "add"],
      ["heavy_minus_sign", "➖", "remove"],
      ["arrow_right", "➡️", ""],
      ["arrow_left", "⬅️", ""],
      ["arrow_up", "⬆️", ""],
      ["arrow_down", "⬇️", ""],
      ["arrows_counterclockwise", "🔄", "refresh sync"],
      ["recycle", "♻️", "reuse"],
      ["infinity", "♾️", ""],
      ["eyes_symbol", "👁️", "watching"],
      ["speech_balloon", "💬", "comment"],
      ["thought_balloon", "💭", "idea"],
      ["zzz", "💤", "sleep"],
      ["hourglass_flowing_sand", "⏳", "waiting"],
      ["red_circle", "🔴", "record blocked"],
      ["large_blue_circle", "🔵", ""],
      ["white_circle", "⚪", ""],
      ["black_circle", "⚫", ""],
      ["large_green_circle", "🟢", "ok healthy"],
      ["large_yellow_circle", "🟡", "warning"],
      ["small_red_triangle", "🔺", "up"],
      ["diamond_shape_with_a_dot_inside", "💠", ""]
    ]
  }
];

const byName = new Map<string, string>();
for (const category of EMOJI_CATEGORIES) {
  for (const [name, char] of category.emoji) byName.set(name, char);
}

const ALIASES: Record<string, string> = {
  thumbsup: "+1",
  thumbsdown: "-1",
  smiling_face: "relaxed",
  tada_face: "tada",
  heart_eyes_face: "heart_eyes",
  white_check: "white_check_mark",
  check: "white_check_mark",
  raised_hand: "wave",
  party: "tada",
  ship: "rocket",
  bug_fix: "bug"
};

export function emojiChar(name: string, customEmoji?: Map<string, string>) {
  const key = name.toLowerCase();
  if (customEmoji?.has(key)) return undefined; // rendered as an image instead
  return byName.get(key) ?? byName.get(ALIASES[key] ?? "") ?? undefined;
}

export function searchEmoji(query: string, limit = 40) {
  const term = query.trim().toLowerCase();
  if (!term) return [];
  const results: Array<[string, string]> = [];
  for (const category of EMOJI_CATEGORIES) {
    for (const [name, char, keywords] of category.emoji) {
      if (name.includes(term) || keywords?.includes(term)) {
        results.push([name, char]);
        if (results.length >= limit) return results;
      }
    }
  }
  return results;
}

const FREQUENT_DEFAULTS = ["+1", "white_check_mark", "eyes", "tada", "heart", "joy", "rocket", "pray"];
const FREQUENT_KEY = "fluidchat:frequent-emoji";

/** Most-used emoji, learned from what you actually pick, with sensible defaults. */
export function frequentEmoji(limit = 12): string[] {
  if (typeof window === "undefined") return FREQUENT_DEFAULTS;
  try {
    const counts = JSON.parse(window.localStorage.getItem(FREQUENT_KEY) ?? "{}") as Record<string, number>;
    const ranked = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([value]) => value);
    return [...ranked, ...FREQUENT_DEFAULTS.filter((name) => !ranked.includes(name))].slice(0, limit);
  } catch {
    return FREQUENT_DEFAULTS;
  }
}

export function rememberEmoji(value: string) {
  if (typeof window === "undefined") return;
  try {
    const counts = JSON.parse(window.localStorage.getItem(FREQUENT_KEY) ?? "{}") as Record<string, number>;
    counts[value] = (counts[value] ?? 0) + 1;
    window.localStorage.setItem(FREQUENT_KEY, JSON.stringify(counts));
  } catch {
    // A full or blocked localStorage just means we keep the defaults.
  }
}

const SKIN_TONES = ["", "\u{1F3FB}", "\u{1F3FC}", "\u{1F3FD}", "\u{1F3FE}", "\u{1F3FF}"];
const TONEABLE = /^(\u{1F44B}|\u{1F44D}|\u{1F44E}|\u{1F44C}|\u{1F44A}|\u{270A}|\u{270C}|\u{1F91E}|\u{1F64F}|\u{1F4AA}|\u{1F44F}|\u{1F64C}|\u{261D})/u;

export function applySkinTone(char: string, tone: number) {
  if (!tone || tone >= SKIN_TONES.length) return char;
  if (!TONEABLE.test(char)) return char;
  return char.replace(/️$/, "") + SKIN_TONES[tone];
}
