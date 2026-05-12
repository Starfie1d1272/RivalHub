// Mock data for RivalHub redesign
window.MOCK = (() => {
  const teamNames = ["VOID", "MERIDIAN", "ASCEND", "PARALLAX", "NORTHGATE", "OBELISK", "ZENITH", "HALCYON"];
  const teamColors = ["#ff6b1a", "#3aa1ff", "#a8ff3a", "#ff3a7a", "#9b6bff", "#ffd23a", "#3affc7", "#ff8a3a"];
  const positions = ["IGL", "AWP", "ENTRY", "LURK", "SUPPORT"];
  const firstNames = ["Lin", "Wei", "Hao", "Yan", "Chen", "Bo", "Kun", "Jie", "Yu", "Tao", "Ren", "Zhe", "Min", "Qi", "Xin"];
  const tags = ["k1ngd0m", "ph4se", "spectr", "valor", "ember", "tide", "axiom", "blitz", "nova", "ronin", "cipher", "echo", "flux", "halo", "ion", "jolt", "krait", "lumen", "myst", "onyx"];

  // 56 players (8 teams x 7)
  const players = [];
  for (let i = 0; i < 56; i++) {
    const pos = positions[i % positions.length];
    const tag = tags[i % tags.length] + (i > 19 ? String(i).padStart(2, "0") : "");
    players.push({
      id: "p" + i,
      tag,
      name: firstNames[i % firstNames.length] + " " + String.fromCharCode(65 + (i % 26)),
      pos,
      rating: 1.0 + (Math.sin(i * 1.3) * 0.18 + 0.1),
      adr: 60 + ((i * 13) % 50),
      kd: 0.85 + ((i * 7) % 40) / 100,
      peakRating: 8000 + ((i * 137) % 5000),
      teamIdx: Math.floor(i / 7),
      isCaptain: i % 7 === 0,
      starter: i % 7 < 5,
      votes: 28 - (i % 28),
      we: 0.62 + ((i * 11) % 30) / 100,
      kpr: 0.6 + ((i * 9) % 35) / 100,
      hltv: 0.95 + (Math.sin(i * 1.7) * 0.18 + 0.15),
    });
  }

  const teams = teamNames.map((n, idx) => ({
    id: "t" + idx,
    name: n,
    tag: n.slice(0, 3),
    seed: idx + 1,
    color: teamColors[idx],
    record: { w: 14 - idx, l: idx },
    map_diff: 18 - idx * 2,
    captain: players.find((p) => p.teamIdx === idx && p.isCaptain),
    roster: players.filter((p) => p.teamIdx === idx),
  }));

  // Matches  (round-robin sample)
  const maps = ["Inferno", "Mirage", "Nuke", "Anubis", "Ancient", "Vertigo", "Dust2"];
  const matches = [];
  let mid = 0;
  for (let r = 0; r < 7; r++) {
    for (let p = 0; p < 4; p++) {
      const ta = (r + p) % 8;
      const tb = (8 - 1 - p + r) % 8;
      if (ta === tb) continue;
      const finished = mid < 14;
      const live = mid === 14;
      matches.push({
        id: "m" + mid,
        ta: teams[ta],
        tb: teams[tb],
        round: r + 1,
        stage: "Regular Season",
        bo: 3,
        status: finished ? "finished" : live ? "live" : "scheduled",
        score: finished ? { a: 2 + (mid % 2), b: (mid + 1) % 2 } : live ? { a: 1, b: 0 } : { a: 0, b: 0 },
        scheduledAt: `2026-05-${13 + r}`,
        time: `${19 + (mid % 3)}:00`,
        maps: maps.slice(0, 3).map((m, i) => ({
          name: m,
          aScore: finished ? 12 + ((mid + i) % 6) : i === 0 && live ? 9 : 0,
          bScore: finished ? 8 + ((mid + i + 1) % 6) : i === 0 && live ? 11 : 0,
          done: finished || (live && i === 0),
        })),
      });
      mid++;
    }
  }

  // Standings
  const standings = teams
    .map((t, i) => ({
      ...t,
      rank: i + 1,
      maps_w: 14 - i,
      maps_l: i + 2,
      rounds_diff: 80 - i * 12,
      streak: i % 3 === 0 ? "W" + (3 - (i % 3)) : "L" + ((i % 2) + 1),
    }))
    .sort((a, b) => b.maps_w - a.maps_w)
    .map((t, i) => ({ ...t, rank: i + 1 }));

  const draftState = {
    round: 3,
    pickNo: 18,
    totalPicks: 56,
    pickingTeam: 2,
    timer: 87,
    timerMax: 120,
    log: [
      { team: 0, player: "k1ngd0m", pos: "IGL", t: "00:42" },
      { team: 7, player: "valor", pos: "AWP", t: "01:12" },
      { team: 6, player: "ph4se", pos: "ENTRY", t: "01:48" },
      { team: 5, player: "spectr", pos: "LURK", t: "02:11" },
      { team: 4, player: "ember", pos: "SUPPORT", t: "02:34" },
      { team: 3, player: "tide", pos: "AWP", t: "03:02" },
      { team: 2, player: "axiom", pos: "ENTRY", t: "03:35" },
      { team: 1, player: "blitz", pos: "IGL", t: "04:09" },
      { team: 1, player: "nova", pos: "LURK", t: "04:52" },
      { team: 2, player: "ronin", pos: "AWP", t: "05:18" },
      { team: 3, player: "cipher", pos: "IGL", t: "05:48" },
    ],
  };

  return { teams, players, matches, standings, draftState, maps, positions };
})();
