export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const q   = url.searchParams.get('q') || '';
  const lat = Number(url.searchParams.get('lat') || '35.5710');
  const lon = Number(url.searchParams.get('lon') || '139.3707');

  // ダミーデータ（配線テスト用）
  const items = [{
    title: "相模川 こけ観察ミッション（自発）",
    description: "石の裏や日陰で観察。写真と観察ノートに残そう。",
    place: "新磯〜高田橋の河原",
    lat: 35.5416, lon: 139.3608,
    price: 0, when: "晴れの日の午後30〜60分",
    tags: ["苔","自然観察","屋外","短時間OK"],
    url: "https://www.google.com/search?q=相模原 河原 苔 観察",
    score: 20, distance_km: 3.2
  }];

  res.status(200).json(items);
}

