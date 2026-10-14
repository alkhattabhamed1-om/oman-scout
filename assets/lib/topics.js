// The thirteen topic ids used by the scan, the ranking, the filters and the search.
// Ids are final (spec section 2.1). `icon` is a plain glyph name; the interface
// maps it to its own icon set, so this file never depends on how icons are drawn.

const list = [
  { id: 'ai', en: 'AI & machine learning', ar: 'الذكاء الاصطناعي وتعلّم الآلة', icon: 'cpu' },
  { id: 'data', en: 'Data science & analytics', ar: 'علم البيانات والتحليل', icon: 'chart' },
  { id: 'software', en: 'Programming & software engineering', ar: 'البرمجة وهندسة البرمجيات', icon: 'code' },
  { id: 'webmobile', en: 'Web & app development', ar: 'تطوير الويب والتطبيقات', icon: 'window' },
  { id: 'cyber', en: 'Cybersecurity', ar: 'الأمن السيبراني', icon: 'shield' },
  { id: 'cloud', en: 'Cloud & infrastructure', ar: 'السحابة والبنية التحتية', icon: 'cloud' },
  { id: 'startups', en: 'Startups & entrepreneurship', ar: 'الشركات الناشئة وريادة الأعمال', icon: 'rocket' },
  { id: 'fintech', en: 'Fintech', ar: 'التقنية المالية', icon: 'coins' },
  { id: 'iot', en: 'IoT, robotics & hardware', ar: 'إنترنت الأشياء والروبوتات والعتاد', icon: 'chip' },
  { id: 'games', en: 'Games & creative tech', ar: 'الألعاب والتقنية الإبداعية', icon: 'gamepad' },
  { id: 'green', en: 'Sustainability & energy tech', ar: 'التقنية المستدامة والطاقة', icon: 'leaf' },
  { id: 'careers', en: 'Careers & networking', ar: 'الوظائف وبناء العلاقات', icon: 'briefcase' },
  { id: 'policy', en: 'Policy & regulation', ar: 'السياسات والتشريعات', icon: 'scale' }
];

/** Every topic as { id, en, ar, icon }, in display order. */
export const TOPICS = Object.freeze(list.map(t => Object.freeze(t)));

/** The topic ids in display order. */
export const TOPIC_IDS = Object.freeze(list.map(t => t.id));

const byId = new Map(list.map(t => [t.id, t]));

/** The label of a topic in 'en' or 'ar'; an unknown id comes back unchanged so nothing renders blank. */
export function topicLabel(id, lang) {
  const t = byId.get(id);
  if (!t) return typeof id === 'string' ? id : '';
  return lang === 'ar' ? t.ar : t.en;
}
