// 实体清单与皮肤列表：设置面板等轻量入口用，不引入 three
export const ENTITIES = [
  { id: "player", label: "玩家" },
  { id: "creeper", label: "苦力怕" },
  { id: "iron_golem", label: "铁傀儡" },
  { id: "villager", label: "村民" },
  { id: "ender_dragon", label: "末影龙" }
] as const;

export type EntityId = (typeof ENTITIES)[number]["id"];

export const PLAYER_SKINS = ["steve", "alex", "ari", "efe", "kai", "makena", "noor", "sunny", "zuri"];