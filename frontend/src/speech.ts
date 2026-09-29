import type { Animal } from './petRenderer';

export type CompanionSpeechEvent =
  | 'launch'
  | 'first-input'
  | 'burst'
  | 'pause'
  | 'idle'
  | 'long-idle'
  | 'pet'
  | 'theme-change'
  | 'surprise';

const LINES: Record<Animal, Record<CompanionSpeechEvent, string[]>> = {
  fox: {
    launch: ['今天也一起加油！'], 'first-input': ['听见啦～'], burst: ['这个节奏很棒！'], pause: ['歇一会儿也好呀。'], idle: ['我在这里陪你。'], 'long-idle': ['要不要起来伸个懒腰？'], pet: ['嘿嘿，被发现了。'], 'theme-change': ['新造型，准备出发！'], surprise: ['哇，吓我一跳！'],
  },
  emojiFox: {
    launch: ['今天也要元气满满！'], 'first-input': ['收到你的节拍！'], burst: ['再来一点，我跟得上！'], pause: ['暂停一下，呼吸～'], idle: ['眨眨眼，继续陪你。'], 'long-idle': ['我都快变成雕像啦。'], pet: ['耳朵被摸到啦！'], 'theme-change': ['这套表情很适合我！'], surprise: ['欸？发生什么啦？'],
  },
  girl: {
    launch: ['今天也请多关照。'], 'first-input': ['我接到你的节奏了。'], burst: ['小心跳加速中！'], pause: ['慢慢来，不着急。'], idle: ['安静陪你一会儿。'], 'long-idle': ['要不要喝口水？'], pet: ['谢谢你的摸摸。'], 'theme-change': ['换个心情再出发。'], surprise: ['诶，突然有精神了！'],
  },
  cat: {
    launch: ['本喵已就位。'], 'first-input': ['嗯，听到了。'], burst: ['节奏不错嘛。'], pause: ['本喵先休息一下。'], idle: ['别忘了眨眼。'], 'long-idle': ['摸鱼时间到。'], pet: ['就、就摸一下哦。'], 'theme-change': ['新衣服还算合身。'], surprise: ['喵？这么突然。'],
  },
  capybara: {
    launch: ['慢慢来，刚刚好。'], 'first-input': ['我也动一动。'], burst: ['呼～跟上啦。'], pause: ['休息也是节奏。'], idle: ['发呆很重要。'], 'long-idle': ['一起放空三分钟？'], pet: ['暖呼呼的。'], 'theme-change': ['换个姿势继续。'], surprise: ['哎呀，吓到了。'],
  },
  shyFox: {
    launch: ['我、我来陪你……'], 'first-input': ['听见了，小声回应。'], burst: ['节奏有点快，但我跟得上！'], pause: ['我先偷偷喘口气。'], idle: ['你忙你的，我在这儿。'], 'long-idle': ['是不是该起来走走啦？'], pet: ['别、别一直看我嘛。'], 'theme-change': ['换好啦……好看吗？'], surprise: ['呀！突然吓我一跳。'],
  },
  yuexinCat: {
    launch: ['打工喵，准时上线。'], 'first-input': ['收到，开始营业。'], burst: ['效率拉满！'], pause: ['下班五分钟也可以。'], idle: ['工位旁边陪你摸会儿鱼。'], 'long-idle': ['今天的工资也在努力。'], pet: ['摸头可不算加班哦。'], 'theme-change': ['新皮肤，继续打卡。'], surprise: ['警觉喵上线！'],
  },
  orangeFox: {
    launch: ['我、我来啦……'], 'first-input': ['听见你的声音了。'], burst: ['这节奏，好害羞……'], pause: ['呼……先缓一下。'], idle: ['偷偷陪你一会儿。'], 'long-idle': ['要不要一起伸伸腿？'], pet: ['唔……被摸到了。'], 'theme-change': ['换好啦，别笑我。'], surprise: ['呀！耳朵都竖起来了。'],
  },
};

const COOLDOWN: Record<CompanionSpeechEvent, number> = {
  launch: 30_000,
  'first-input': 9_000,
  burst: 18_000,
  pause: 12_000,
  idle: 28_000,
  'long-idle': 45_000,
  pet: 16_000,
  'theme-change': 8_000,
  surprise: 18_000,
};

/**
 * Chooses short, local-only lines from anonymous interaction events. It never
 * receives keyboard text; the cooldown keeps the companion from narrating
 * every keystroke.
 */
export class SpeechDirector {
  private lastAt = Number.NEGATIVE_INFINITY;
  private lastEvent: CompanionSpeechEvent | undefined;
  private serial = 0;

  reset() {
    this.lastAt = Number.NEGATIVE_INFINITY;
    this.lastEvent = undefined;
    this.serial = 0;
  }

  trigger(animal: Animal, event: CompanionSpeechEvent, now: number, enabled = true): string | undefined {
    if (!enabled || !Number.isFinite(now)) return undefined;
    const cooldown = COOLDOWN[event];
    if (now - this.lastAt < cooldown) return undefined;
    // Avoid repeating the same low-priority idle line after a reset.
    if (event === this.lastEvent && (event === 'idle' || event === 'long-idle')) return undefined;
    const pool = LINES[animal][event];
    if (!pool?.length) return undefined;
    const line = pool[this.serial % pool.length];
    this.serial += 1;
    this.lastAt = now;
    this.lastEvent = event;
    return line;
  }
}
