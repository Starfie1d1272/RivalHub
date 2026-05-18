import type { Metadata } from "next";
import { Marker } from "@/components/rivalhub/Marker";
import { Panel } from "@/components/rivalhub/Panel";

export const metadata: Metadata = {
  title: "规则书 | NJU Rivals 2026 Spring",
  description: "NJU Rivals 2026 春季赛官方规则书 — 报名规则、赛制、BP流程、反作弊条款",
};

export default function RulesPage() {
  return (
    <div className="max-w-4xl mx-auto py-12 px-4 space-y-6">
      {/* Hero */}
      <section className="space-y-2 pb-6" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <h1
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 32,
            fontWeight: 700,
            letterSpacing: "var(--tracking-label)",
            color: "var(--color-accent)",
          }}
        >
          NJU RIVALS 规则书
        </h1>
        <p style={{ color: "var(--color-fg-mid)", fontSize: 14 }}>
          2026 Spring Season · 南京大学 CS2
        </p>
      </section>

      {/* 一、比赛简介 */}
      <Panel pad={20}>
        <Marker>一、比赛简介</Marker>
        <p>
          NJU Rivals 是南京大学 CS2 社团举办的校内赛事，定位为「纯校内、强竞技」。
          与秋季赛（Major 赛制 + 三人本校 + 自由组队）的差分定位不同，春季赛在以下方面做出更高限制：
        </p>
        <ul className="list-disc pl-5 space-y-1 mt-2">
          <li>仅限校内（含毕业生），不接受外校选手</li>
          <li>强制段位与活跃度门槛</li>
          <li>禁止自由组队，统一蛇形选秀</li>
          <li>位置主副选制，避免银河战舰</li>
        </ul>
        <p className="mt-3">
          本届春季赛旨在为校内有竞技追求的玩家提供更高强度的对抗舞台，并产出一届真正能体现校内顶尖水平的赛事记录。
        </p>
      </Panel>

      {/* 二、比赛时间安排 */}
      <Panel pad={20}>
        <Marker>二、比赛时间安排</Marker>
        <ul className="list-disc pl-5 space-y-1">
          <li>报名期：报名通道预计于公告发布后 1-2 周内开放，开放时间预计持续 3 天</li>
          <li>审核与队长投票：报名截止后 2-3 天内完成</li>
          <li>蛇形选秀：队长名单确定后的指定晚间，全程网站直播</li>
          <li>排位赛：选秀后第一周末集中开赛，平日晚间分散补打</li>
          <li>正赛：排位赛结束后的连续两个周末</li>
        </ul>
        <p className="mt-3" style={{ color: "var(--color-fg-mid)" }}>
          具体日期由赛委会在选秀完成后根据参赛队伍情况发布。
        </p>
      </Panel>

      {/* 三、报名规则 */}
      <Panel pad={20}>
        <Marker>三、报名规则</Marker>

        <Section heading="3.1 资格要求">
          <ul className="list-disc pl-5 space-y-1">
            <li>段位门槛：当前赛季完美平台最高段位达到 A，或历史最高段位达到 A+ 及以上（其他平台等效水平见附录段位映射表）</li>
            <li>活跃度要求：Steam 累计游戏时长 ≥ 500 小时；报名前两周内完美/5E天梯有效场次 ≥ 5 场</li>
            <li>身份要求：南京大学在校生或毕业生（毕业生须填写毕业年份与所属学院）</li>
            <li>诚信要求：禁止使用小号隐藏实力、禁止代打、禁止冒名顶替；一经发现按反作弊条款严肃处理</li>
          </ul>
        </Section>

        <Section heading="3.2 报名信息">
          <p>报名时需在官方报名网站填写以下信息（全部为必填，除明确标注「可选」者外）：</p>

          <SubSection heading="3.2.1 基础信息" />
          <ul className="list-disc pl-5 space-y-1">
            <li>学号（毕业生填写毕业年份 + 所属学院）</li>
            <li>QQ</li>
            <li>完美 ID</li>
            <li>Steam 昵称</li>
            <li>Steam 64 位 ID</li>
            <li>Steam 个人资料链接（必须设为公开，便于核验时长）</li>
          </ul>

          <SubSection heading="3.2.2 段位与活跃度信息" />
          <ul className="list-disc pl-5 space-y-1">
            <li>历史最高段位（含赛季）+ 对应赛季 rating + we</li>
            <li>当前段位 + 当前赛季 rating + we</li>
            <li>近两周内 5 场天梯截图（用于活跃度核验，需包含日期、地图、比分、ID 等关键信息）</li>
          </ul>

          <SubSection heading="3.2.3 位置信息" />
          <ul className="list-disc pl-5 space-y-1">
            <li>主选位置：IGL（指挥）/ AWPer（狙击手）/ Opener (Entry)（突破手）/ Closer (Lurker)（自由人/残局）/ Anchor (Support)（主防）任选其一</li>
            <li>次选位置：与主选位置不能相同</li>
            <li>游戏风格自述：不超过 100 字，例如「拼抢型」「道具流」「战术型」「站位稳健」等</li>
            <li>是否愿意担任队长：勾选项；推荐主选 IGL 者勾选</li>
          </ul>
          <Callout>
            注意：报名前务必仔细思考自己的位置，每个位置主选选手报满 15 人就无法选择了。务必选择自己最擅长的位置，并且报名通道开启后尽快报名！
          </Callout>

          <SubSection heading="3.2.4 经历与承诺" />
          <ul className="list-disc pl-5 space-y-1">
            <li>历史比赛经历（NJU Major 往届成绩、其他校内外赛事，可选填）</li>
            <li>高光视频（可选）：njubox 或其他可访问外链；命名格式「完美ID_主选位置.mp4」；时长 ≤ 3 分钟；公开可观看</li>
            <li>反作弊承诺勾选确认（详见第七章）</li>
          </ul>
        </Section>

        <Section heading="3.3 报名审核">
          <p>报名采取「先审核后录取」机制，按以下顺序确定入围名单：</p>

          <Paragraph heading="第一优先级：赛委会审核（一票否决）">
            审核维度包括：
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li>信息真实性：Steam 时长、段位截图、近两周活跃度截图与公开资料一致</li>
              <li>身份真实性：NJU 学籍 / 毕业身份核验</li>
              <li>过往无作弊、代打、严重违规记录</li>
              <li>提交完整度：所有必填字段无敷衍式填写</li>
            </ul>
          </Paragraph>

          <Paragraph heading="第二优先级：位置主选人数限制">
            每个主选位置报名上限为 15 人，达到上限后该位置主选通道实时关闭。报名网站将在表单页实时显示各位置当前主选人数。最终入围人数上限为 56 人；若总审核通过人数超过 56 人，则根据 3.3 报名审核规则确定最终入围名单，其余选手进入候补名单。
          </Paragraph>

          <Paragraph heading="第三优先级：同位置主选录取顺序">
            同一主选位置在未满员时，原则上按报名提交时间优先录取。本届赛事不采用单纯按段位、rating 或历史成绩排序的方式录取，以避免形成过度实力筛选。
          </Paragraph>
          <p className="mt-2">
            但赛委会在审核阶段保留综合判断权：若出现报名信息明显失真、活跃度不足、历史段位与当前表现严重不符、疑似小号隐藏实力、长期失联、位置填写明显敷衍等情况，赛委会可根据账号记录、平台数据、历史比赛经历、社团活跃度与实际沟通情况作出调整、候补或不予录取决定。
          </p>
          <p className="mt-1">在同等条件下，仍以报名提交时间靠前者优先。</p>

          <Paragraph heading="队长录取">
            <ul className="list-disc pl-5 space-y-1">
              <li>若勾选「愿意担任队长」者不足 8 人：赛委会在群内二次招募，优先邀请主选 IGL、社团活跃成员、往届队长担任</li>
              <li>若恰好 8 人：直接担任，选秀顺位由赛委会按综合活跃度与历史成绩排定</li>
              <li>若超过 8 人：由全体审核通过的选手投票，得票前 8 人担任队长，且得票数同时决定蛇形选秀第一轮顺位（票数最高者第 1 顺位）</li>
            </ul>
          </Paragraph>
        </Section>

        <Section heading="3.4 段位映射表（参考）">
          <p>
            用于其他平台主战玩家自评门槛。最终是否符合资格仍以完美平台数据为准；若主战其他平台，需在报名时附上对应平台账号链接供赛委会核验。
          </p>
          <div className="mt-3 overflow-x-auto">
            <table
              className="w-full border-collapse text-sm"
              style={{ border: "1px solid var(--color-border)" }}
            >
              <thead>
                <tr style={{ background: "var(--color-panel-low)" }}>
                  <th className="px-3 py-2 text-left font-bold" style={{ border: "1px solid var(--color-border)" }}>完美平台</th>
                  <th className="px-3 py-2 text-left font-bold" style={{ border: "1px solid var(--color-border)" }}>5E 平台</th>
                  <th className="px-3 py-2 text-left font-bold" style={{ border: "1px solid var(--color-border)" }}>官匹</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="px-3 py-2" style={{ border: "1px solid var(--color-border)" }}>A / A+（最低门槛）</td>
                  <td className="px-3 py-2" style={{ border: "1px solid var(--color-border)" }}>A / A+</td>
                  <td className="px-3 py-2" style={{ border: "1px solid var(--color-border)" }}>18000</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>
      </Panel>

      {/* 四、队伍组建 */}
      <Panel pad={20}>
        <Marker>四、队伍组建</Marker>

        <Section heading="4.1 队伍构成">
          <ul className="list-disc pl-5 space-y-1">
            <li>共 8 支队伍</li>
            <li>每队配置：1 名队长 + 4 名首发 + 2 名替补，共 7 人</li>
            <li>总参赛人数：56 人</li>
            <li>排位赛 BO1 可在每场比赛前确定参赛名单；BO3 / BO5 系列赛可在系列赛开始前确定参赛名单。系列赛进行中不得临时更换未报备选手</li>
            <li>为保障替补选手的参赛体验，排位赛阶段每支队伍原则上应安排两名替补均获得实际出场机会。若因赛程、阵容磨合、选手个人时间等原因无法安排出场，队长需提前与替补本人沟通，并在必要时向赛委会说明。</li>
            <li>建议每名替补在排位赛阶段至少获得 1 场 BO1 出场机会；若实际情况不允许，队伍应优先保障替补参与训练、战术沟通、地图准备与赛前安排。</li>
            <li>正赛阶段是否启用替补由队伍根据竞技需要自行决定，但不得以恶意排挤、长期无沟通、虚假承诺等方式损害替补权益。若替补认为自身参赛权益受到明显影响，可向赛委会反馈，赛委会将视情况进行协调。</li>
          </ul>
        </Section>

        <Section heading="4.2 蛇形选秀">
          <ul className="list-disc pl-5 space-y-1">
            <li>8 名队长按队长投票得票数排定第 1 轮选人顺位（1 → 8）</li>
            <li>第 2 轮反向（8 → 1），第 3 轮正向（1 → 8），依此类推（标准蛇形）</li>
            <li>选秀共 6 轮，每队选完 6 人（4 首发 + 2 替补，加上队长本人共 7 人）</li>
            <li>每人选秀时限 3 分钟，超时后由系统按照赛委会预设的综合排序自动递补</li>
            <li>选秀过程将在赛委会搭建的官方网站进行实时直播，全员可观战；队长在专属选秀面板操作</li>
          </ul>
        </Section>

        <Section heading="4.3 位置约束">
          <ul className="list-disc pl-5 space-y-1">
            <li>选秀时每队累计同主选位置不能超过 2 人，避免极端阵容</li>
            <li>队伍可根据实际情况协商调整分工，但应尊重选手报名时填写的主副选位置</li>
            <li>若选秀过程中出现某位置选手已被选完而其他队伍仍需该位置的情况，可启用次选位置进行补位</li>
          </ul>
        </Section>
      </Panel>

      {/* 五、赛制 */}
      <Panel pad={20}>
        <Marker>五、赛制</Marker>

        <Section heading="5.1 排位赛（小组循环）">
          <ul className="list-disc pl-5 space-y-1">
            <li>8 支队伍单循环，共 28 场 BO1</li>
            <li>作用：队伍磨合 + 确定正赛种子</li>
            <li>时间安排：第一周末集中开赛，平日晚间分散补打</li>
            <li>排名规则：胜场 &gt; 净胜回合数 &gt; 总胜回合数 &gt; 队伍间相互比赛战绩 &gt; 抽签</li>
          </ul>
          <p className="mt-2">
            排位赛阶段所有队伍均应以合理竞技态度完成每一场比赛，不得以挑选正赛对手、影响其他队伍排名、隐藏阵容、消极比赛等目的故意放弃比赛或明显降低竞技强度。
          </p>
          <p className="mt-1">
            若赛委会根据比赛 demo、第一视角录像、队内外聊天记录、临场行为、异常换人安排等证据，认定某队存在明显消极比赛或恶意影响排名行为，可视情节给予警告、取消该场胜场、调整种子顺位、判负，或取消后续参赛资格。
          </p>
          <p className="mt-1" style={{ color: "var(--color-fg-mid)" }}>
            队伍进行正常轮换、替补出场、练习阵容不视为消极比赛，但应保持基本竞技态度。
          </p>
        </Section>

        <Section heading="5.2 正赛（双败淘汰）">
          <ul className="list-disc pl-5 space-y-1">
            <li>8 支队伍按排位赛种子进入双败赛制</li>
            <li>胜者组首轮、半决赛、决赛：BO3</li>
            <li>败者组所有轮次：BO3</li>
            <li>总决赛：BO5，胜者组冠军优先 ban 两张图，败者组冠军优先选择第一张图，详细流程见 BP 规则</li>
          </ul>
        </Section>

        <Section heading="5.3 BP 规则">
          <p className="mb-3" style={{ color: "var(--color-fg-mid)" }}>
            比赛地图池默认采用赛事开始时 CS2 官方现役服役地图池。
          </p>

          <Paragraph heading="BO1 BP 流程">
            <ol className="list-decimal pl-5 space-y-1">
              <li>种子较高方选择 Team A 或 Team B</li>
              <li>Team A 移除 2 张地图</li>
              <li>Team B 移除 3 张地图</li>
              <li>Team A 移除 1 张地图</li>
              <li>Team B 选择起始边</li>
            </ol>
          </Paragraph>

          <Paragraph heading="BO3 BP 流程">
            <ol className="list-decimal pl-5 space-y-1">
              <li>种子较高方选择 Team A 或 Team B</li>
              <li>Team A 移除 1 张地图</li>
              <li>Team B 移除 1 张地图</li>
              <li>Team A 选第 1 张地图</li>
              <li>Team B 选第 1 张地图的起始边</li>
              <li>Team B 选第 2 张地图</li>
              <li>Team A 选第 2 张地图的起始边</li>
              <li>Team B 移除 1 张地图</li>
              <li>Team A 移除 1 张地图，剩下的为决胜图</li>
              <li>Team B 选决胜图起始边</li>
            </ol>
          </Paragraph>

          <Paragraph heading="BO5 BP 流程（总决赛专用）">
            <ol className="list-decimal pl-5 space-y-1">
              <li>胜者组冠军选择担任 Team A，败者组冠军为 Team B</li>
              <li>Team A 移除 1 张地图</li>
              <li>Team A 移除 1 张地图（两次连续 ban 为胜者组冠军优势）→ 剩余 5 张地图进入选图阶段</li>
              <li>Team B 选第 1 张地图 → Team A 选起始边</li>
              <li>Team A 选第 2 张地图 → Team B 选起始边</li>
              <li>Team B 选第 3 张地图 → Team A 选起始边</li>
              <li>Team A 选第 4 张地图 → Team B 选起始边</li>
              <li>剩余 1 张地图为第 5 张（决胜图）→ 起始边由刀赛决定</li>
            </ol>
          </Paragraph>
        </Section>
      </Panel>

      {/* 六、比赛执行规则 */}
      <Panel pad={20}>
        <Marker>六、比赛执行规则</Marker>

        <Section heading="6.1 比赛时间确认">
          <p>
            对于赛委会未指定固定开赛时间的比赛，双方队长须通过官方比赛网站完成比赛时间确认。
            对阵生成后，任一方队长可从赛委会预设时间段中选择，或在赛委会允许的情况下自行填写符合赛事安排要求的比赛时间，并向对方发起时间提议；也可提交多个本队可接受的空余时间段供对方选择。
            合法时间须满足：不早于系统允许的最早开赛时间、不晚于该阶段赛程截止时间、不与赛委会已指定的直播/比赛安排冲突，且原则上不得设置在明显不合理时段。
          </p>
          <p className="mt-2">
            收到时间提议后，另一方队长须在网站显示的截止时间前完成回应，包括同意、拒绝并说明原因、从可选时间中选择一个，或提出新的可行时间。若双方在截止时间前达成一致，该时间即作为正式比赛时间，并由系统记录。
          </p>
          <p className="mt-2">
            若双方在截止时间前未能达成一致，或一方队长未按时回应，系统将默认采用最先发起时间提议一方所选择的具体合法时间作为正式比赛时间；若该时间与赛程、直播、服务器或其他赛事安排冲突，赛委会有权指定最终比赛时间。
          </p>
          <p className="mt-2">
            正式比赛时间确认后，双方队伍应按时参赛，未经赛委会同意不得擅自更改。恶意拖延回应、反复无理由拒绝、临近开赛无故改期或其他影响赛程推进的行为，赛委会可视情节给予警告、强制指定比赛时间、判负或其他处罚。
          </p>
          <p className="mt-2">
            双方队长须在每场比赛正式开赛前至少 2 小时，于官方比赛网站提交本场参赛名单。BO1 提交本场比赛名单；BO3 / BO5 提交该系列赛名单。系列赛开始后，除突发技术原因并经赛委会同意外，不得临时更换未报备选手。若未按时提交名单，赛委会有权要求立即补交；情节严重或影响比赛正常开始的，可给予警告或判负。
          </p>
        </Section>

        <Section heading="6.2 赛前流程">
          <p>解说调试直播间，OB 及解说按照排班表的顺序接管对应比赛（若临时有事，需自行联系有空的赛委会成员进行替换）。</p>
          <p className="mt-2">
            OB、解说和双方队伍各成员提前 5 分钟进入 TeamSpeak（TS）对应比赛的总频道，语音房间内除了工作人员和双方队长外，其余选手保持闭麦状态，防止频道过于吵闹。如有选手出现 TS 语音无法正常沟通情况，可告知 OB，可令选手使用游戏麦并由 OB 监督，以防出现报点等情况出现。
          </p>
          <p className="mt-2">
            TS 房间进入完毕后，工作人员和双方队伍进入完美赛时服务器（房间由裁判或解说创建，创建完之后会直接推送至每个队员的完美界面，解说将直播间号发在队长群中，也可以直接在 GOTV 观看）。解说与 OB 进入观战席。
          </p>
          <p className="mt-2">
            在这 5 分钟内，导播将检查双方队伍成员信息是否正确，如发现问题（代打、未报备换人等），自动判负，剥夺比赛权利。在此期间，解说配合进行检查，选手自行检查网络状态、TS 语音状态等。
          </p>
          <p className="mt-2">
            点击开始比赛后，第一阶段队长选择自己队员，注意不要选错队员，否则需要重新开启服务器。第二阶段进行地图和服务器 BP，此 BP 环节将在比赛开始前完成，工作人员将进行手动 BP。
          </p>
          <p className="mt-2">
            进入选定比赛图后，选手需开启友伤，BO3 / BO5 赛制 pick 的另一方选边并关闭拼刀，根据选边结果顺序进入总频道下面的上半场 T / 上半场 CT 频道语音，总频道内只有工作人员，以防有人偷听报点（直播间开启延时，同理，一旦发现剥夺比赛权利并自动判负），更换半场后无需更换语音频道。
          </p>
          <Callout>
            特殊情况说明：如果队长在地图选择环节掉线；第一次掉线，战队可以申请重新进行 Veto，但是必须维持掉线前的 Veto 结果；后续如果继续掉线，不予重新进行 Veto，比赛将按照既定的 Veto 结果进行比赛。
          </Callout>
        </Section>

        <Section heading="6.3 服务器设置">
          <p>比赛服务器：Beijing、Shanghai、Chengdu、Shenzhen、Hangzhou。</p>
          <p>每场比赛前，由双方队长进行服务器 BP，裁判可根据特定情形要求战队按照指定的服务器进行比赛。</p>
        </Section>

        <Section heading="6.4 比赛中">
          <p>解说和 OB 负责直播间秩序管理，统计在直播间观看比赛并进行督察，若有问题及时汇报在赛委会群内，若问题属实立刻暂停比赛处理。</p>
          <p className="mt-2 font-medium" style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>
            选手可用命令：
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><code>.ready</code> — 战队选手个人表示准备完成可以开始比赛的信号</li>
            <li><code>.unready</code> — 如果在开始比赛前有任何问题，此命令可以用来放弃开始比赛</li>
            <li><code>.pause</code> — 战队可以用于战术暂停</li>
            <li><code>.tech</code> — 战队可以用于技术暂停</li>
            <li><code>.unpause</code> — 结束当局比赛的暂停（两支战队均需要使用此命令）</li>
            <li><code>.stop</code> — 战队可以用于提出回档，回档后将会自动暂停</li>
          </ul>
        </Section>

        <Section heading="6.5 暂停与中断规则">
          <Paragraph heading="迟到">
            若在规定的比赛开始时间 15 分钟内人员未到齐的一方将被系统自动判负；若双方均未到齐，则双方均为负。如该方有合规替补，可申请补位。
          </Paragraph>
          <Paragraph heading="战术暂停">
            每盘比赛（即每张地图），每支战队最多可以叫 3 次战术暂停；每个加时赛中，每支战队将获得 1 次额外的战术暂停；允许在一个战术暂停结束后立即激活下一个战术暂停。
          </Paragraph>
          <Paragraph heading="技术暂停">
            技术暂停仅限当选手遇到技术问题时激活。线上比赛时，战队发起技术暂停后需要立即通知管理员，表明需要技术暂停的原因。一般情况下，允许最长的暂停时间总共 15 分钟，超时后对手可申请比赛继续，无论您是否已经解决技术问题。
          </Paragraph>
          <Paragraph heading="比赛中断">
            当本回合比赛已经产生伤害、或回合剩余时间不足 1 分钟、或有可信服的证据表示某一阵营已取得绝对优势，本回合比赛将不予回档；遇上极端的服务器崩溃的情况，本局比赛将从已完成的最后被记录的那局比赛开始。
          </Paragraph>
        </Section>

        <Section heading="6.6 赛后流程">
          <p>调度统计比赛结果并及时安排下一阶段对阵表。各队伍选手需将自己的准星截图发给队长，队长整合后发在队长群中，OB 每场比赛需检查选手准星，防止代打 / 作弊情况出现。每位选手需保留第一视角录像，如有人举报，需调取查验。</p>
        </Section>

        <Section heading="6.7 队内争议与赛委会裁量">
          <p>队伍内部的出场安排、位置分配、训练安排、战术分歧等问题，原则上由队长与队员自行协商解决。队长应尊重队员报名时填写的主副选位置与实际参赛意愿，避免长期无沟通地排除特定队员或替补。</p>
          <p className="mt-2">
            若队内争议已经明显影响比赛正常进行，例如拒绝参赛、临场罢赛、恶意不配合、强行更换阵容、替补权益争议、队员与队长无法就出场安排达成基本一致等，相关人员可向赛委会反馈。
          </p>
          <p className="mt-2">
            赛委会将听取队长、相关队员及必要工作人员意见，并基于赛事公平性、比赛可执行性与整体观赛体验作出最终裁定。所有参赛选手均须遵守赛委会裁定。
          </p>
        </Section>
      </Panel>

      {/* 七、反作弊条款 */}
      <Panel pad={20}>
        <Marker>七、反作弊条款</Marker>
        <p>报名即视为同意以下全部条款。报名表中的反作弊承诺勾选项必须确认勾选方可提交。</p>
        <ul className="list-disc pl-5 space-y-1 mt-3">
          <li>不使用任何外挂、辅助软件、宏脚本</li>
          <li>不寻找代打，不冒名顶替，不使用小号隐藏实力</li>
          <li>比赛推荐全程开启第一视角录像；如被举报等情况方便赛委会处理</li>
          <li>比赛中所有选手须提交准星截图，由队长汇总至队长群</li>
          <li>不在比赛中通过任何外部渠道获取对手信息（直播延时观看、报点、共享视角等均属违规）</li>
          <li>禁止队长之间以明显破坏赛事公平性为目的，恶意操控选秀结果。赛委会有权根据聊天记录、选秀行为与相关证据综合认定</li>
        </ul>

        <div className="mt-6">
          <h4 className="font-bold mb-2">处罚机制</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>作弊本人</strong>：本届永久禁赛 + 所在队伍判负 + 联动其他校内 / 跨校 CS 赛事社团黑名单</li>
            <li><strong>队长知情不报或包庇</strong>：禁赛一届 + 队伍判负</li>
            <li><strong>队伍其他成员知情不报</strong>：禁赛一届</li>
          </ul>
          <p className="mt-2" style={{ color: "var(--color-fg-mid)" }}>
            赛委会将结合第一视角录像、demo、截图、账号记录等证据综合认定。
          </p>
          <p className="mt-2">
            赛委会保留对所有影响赛事公平性的行为进行调查与裁定的权力。调查范围包括但不限于：外挂与辅助软件、代打或冒名顶替、小号隐藏实力、外部报点、恶意操控选秀、消极比赛、恶意放弃、故意影响排名、串通比赛、破坏队伍正常参赛等。
          </p>
          <p className="mt-2">
            赛委会可根据完美 demo、第一视角录像、准星截图、账号记录、聊天记录、语音记录、直播录像、OB 与解说反馈、双方队伍说明等材料进行综合判断。参赛选手有义务在合理时间内配合提供相关材料；拒不配合、拖延提交或提交明显异常材料者，赛委会可作出不利认定。
          </p>
          <p className="mt-2">
            处罚方式包括但不限于：口头警告、书面警告、取消单场成绩、单场判负、调整种子顺位、禁赛、取消队伍资格、取消个人后续参赛资格，以及通报至相关校内赛事组织。
          </p>
        </div>
      </Panel>

      {/* 八、赛委会与解说 */}
      <Panel pad={20}>
        <Marker>八、赛委会与解说</Marker>
        <p>本届赛事由 NJU CS2 社团赛委会主办，沿用往届成熟的解说与 OB 班底。</p>
        <ul className="list-disc pl-5 space-y-1 mt-2">
          <li>赛委会负责：报名审核、选秀监督、赛程编排、争议仲裁、奖项评定</li>
          <li>解说与 OB 负责：直播间运营、比赛监督、准星检查、突发情况处理</li>
          <li>解说招募：本届若有意担任解说者，可在群内联系赛委会</li>
        </ul>
        <p className="mt-3 font-bold">所有最终解释权归 NJU CS2 社团赛委会所有。</p>
      </Panel>

      {/* 九、联系方式 */}
      <Panel pad={20}>
        <Marker>九、联系方式</Marker>
        <ul className="list-disc pl-5 space-y-1">
          <li>QQ 群：895849839</li>
          <li>赛委会负责人：星宇（2598570936）</li>
          <li>官方报名网站：match.starfie1d.top</li>
          <li>赛事问题反馈：群内 @ 赛委会成员</li>
        </ul>
        <div
          className="mt-5 pt-4"
          style={{ borderTop: "1px solid var(--color-border)" }}
        >
          <p className="font-bold">若规则书未覆盖特殊情况，赛委会有权基于赛事公平性、可执行性与整体观赛体验进行临时裁定。</p>
        </div>
      </Panel>
    </div>
  );
}

// ── Internal helpers ──────────────────────────────────────────────

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="mt-6 pt-4" style={{ borderTop: "1px solid var(--color-border)" }}>
      <h3 className="font-bold text-lg mb-2">{heading}</h3>
      {children}
    </div>
  );
}

function SubSection({ heading }: { heading: string }) {
  return (
    <h4 className="font-semibold mt-4 mb-2" style={{ fontSize: 14, color: "var(--color-fg-mid)" }}>
      {heading}
    </h4>
  );
}

function Paragraph({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <h4 className="font-semibold mb-1" style={{ fontSize: 14 }}>{heading}</h4>
      {children}
    </div>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mt-3 px-3 py-2.5 rounded-sm"
      style={{
        borderLeft: "3px solid var(--color-accent)",
        background: "var(--color-panel-hi)",
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}
