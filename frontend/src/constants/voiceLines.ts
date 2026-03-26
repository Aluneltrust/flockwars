// ============================================================================
// VOICE LINES
// ============================================================================

export const VOICE_LINES = {
  miss: [
    "I hit my leg!", "Damnit, I'm losing coins!", "My back! I'm too old for this!",
    "Missed again? I need glasses!", "The sheep are laughing at me!",
    "I scratched my rod!", "Son of a shepherd!", "What the flock was that?!",
    "Satoshi would be disappointed!", "That's coming out of my UTXO!",
    "My private key is crying!", "Even Craig could hit that!",
    "Hash rate: ZERO!", "404: Sheep not found!", "I'm bleeding sats over here!",
    "This is worse than a 51% attack!", "Sweet mother of Merkle trees!",
    "I'd rather lose my seed phrase!",
  ],
  hit: [
    "GOTCHA!", "Wool you look at that!", "Baaa-bye sheep!",
    "Mutton for dinner tonight!", "Ka-ching! Show me the money!",
    "Satoshi would be proud!", "Satoshi ain't vegan!",
    "That's on-chain forever baby!", "Block confirmed! Sheep destroyed!",
    "Proof of WHACK!", "Immutable damage!", "Get rekt, woolly!",
    "Blockchain doesn't lie: you're toast!", "HODL this, lamb chop!",
    "Signed, sealed, DESTROYED!", "Zero confirmation... zero sheep!",
  ],
  enemyHit: [
    "NOOO! Not Fluffy!", "My precious wool!", "They got Bartholomew!",
    "That sheep had a family!", "I'll never financially recover from this!",
    "You absolute donkey!", "Lucky shot, butthead!", "My wallet is bleeding!",
    "May your transactions never confirm!", "Your mother was a goat herder!",
    "I'll fork your whole family tree!", "Curse your merkle roots!",
  ],
  enemyMiss: [
    "Ha! Missed me!", "Too slow!", "My sheep have plot armor!",
    "Can't touch this!", "Your aim is worse than mine!",
    "Is that your best shot, farm boy?!", "My grandma swings harder!",
    "Your rod must be made of spaghetti!", "Error 404: Skill not found!",
  ],
  victory: [
    "I am the sheep whacker champion!", "Who's baaaa-d now?!",
    "Winner winner, mutton dinner!", "Your sheep got REKT, son!",
    "Proof of VICTORY!", "Thanks for the sats, sucker!",
  ],
  defeat: [
    "My sheep... my beautiful sheep...", "I blame lag!",
    "I got rekt harder than Mt. Gox!", "Satoshi has abandoned me...",
    "This is the darkest timeline...",
  ],
  startGame: [
    "Let's get ready to rumble!", "It's whackin' time!",
    "Prepare for sheepocalypse!", "Let the sheep slaughter BEGIN!",
  ],
  // Platform greedy bag-holder voice (quiet, mocking)
  platformMiss: [
    "Yesss... more sats for me...",
    "Keep missing, peasants...",
    "My bags are getting heavier...",
    "Thank you for your donation...",
    "Miss more, I need a new lambo...",
    "Delicious... more fees...",
    "The house always wins...",
    "Feed me your sats...",
    "Mmmm... tasty transaction fees...",
    "My precious satoshis...",
    "Another miss? How generous...",
    "I love the smell of fees in the morning...",
    "Keep whacking... I mean missing...",
    "Your loss is my gain, literally...",
    "Cha-ching! Thanks sucker...",
  ],
  platformHit: [
    "Ugh... a hit... less fees for me...",
    "Fine, take some sats... for now...",
    "Lucky shot... my bags weep...",
    "Hmph... skilled players are bad for business...",
  ],
  platformGameEnd: [
    "Time to count my precious sats...",
    "Half for you, half for ME! Hehehe...",
    "Thanks for playing... and paying...",
    "Come back soon... I need more fees...",
    "The pot is mine... I mean, partly yours...",
  ],
};

export type VoiceCategory = keyof typeof VOICE_LINES;
export type PlatformVoiceCategory = 'platformMiss' | 'platformHit' | 'platformGameEnd';