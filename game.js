// =============================================
// 🩰 芭蕾剧院经理 — 游戏逻辑
// DZMM Gamefy Platform
// =============================================

// 通知父窗口 iframe 已准备好
if (window.parent !== window) {
    window.parent.postMessage('iframe:content-ready', '*');
}

function isDzmmInjected() {
    return !!(window.dzmm && window.dzmm.completions && window.dzmm.chat && window.dzmm.kv);
}

const dzmmReady = new Promise((resolve) => {
    if (isDzmmInjected()) return resolve('injected');
    const handler = (event) => {
        if (event.data?.type === 'dzmm:ready') {
            window.removeEventListener('message', handler);
            resolve('message');
        }
    };
    window.addEventListener('message', handler);
    const t0 = Date.now();
    const timer = setInterval(() => {
        if (isDzmmInjected()) {
            clearInterval(timer);
            window.removeEventListener('message', handler);
            resolve('poll');
            return;
        }
        if (Date.now() - t0 > 5000) {
            clearInterval(timer);
            window.removeEventListener('message', handler);
            resolve('timeout');
        }
    }, 60);
});

// =============================================
// 3D 绘画提示词模板（来自提示词.txt）
// =============================================
const DRAW_PROMPT_POSITIVE_BASE = `best quality, masterpiece, realistic,
2.00::3D ::,
1.20::Artist:jagercoke ::,
1.40::Artist:yinse_qi_ji ::,
1.50::Artist:nixeu ::,
0.50::Artist:ria_(baka-neearts) ::,
1.40::artist:seven_(sixplusone) ::,
very aesthetic, masterpiece, no text, photorealistic, hyperrealistic, realistic skin texture, skin pores,
volumetric lighting, soft shadows,
detailed eyes with reflections, eyelash details,
8k, sharp focus, depth of field`;

const DRAW_PROMPT_NEGATIVE = `low quality, worst quality, anime, cartoon, painting, drawing, oversaturated, deformed hands, extra fingers, mutated hands, unnatural lighting, unrealistic eyes, plastic skin, doll-like, symmetry, blurry background, poorly drawn face, text, watermark, abstract background, low resolution`;

// =============================================
// Alpine Store
// =============================================
document.addEventListener('alpine:init', () => {
    Alpine.store('game', {
        // ---- 基础状态 ----
        loading: true,
        started: false,
        disabled: false,
        generating: false,

        // ---- 设置 ----
        theaterName: '',
        playerName: '',
        model: 'nalang-xl-0826',

        // ---- 游戏核心状态 ----
        money: 50000,
        day: 1,
        theaterFame: 0,
        dancers: [],         // [{id, name, age, appearance, obedience, fame, stamina, specialty, drawPrompt, imageUrl, footDesc}]
        
        // ---- 叙事 ----
        chat_content: '',
        messages: [],        // [{id, role, content}]
        history: [],         // 给 AI 的上下文
        tailId: null,

        // ---- 输入 ----
        inputText: '',
        recruitPrompt: '',   // 用户自定义招募提示词

        // ---- UI 状态 ----
        selectedDancer: null,
        dancerDetailOpen: false,
        saveManagerOpen: false,
        editModalOpen: false,
        editingIndex: -1,
        editingContent: '',
        eventModalOpen: false,
        eventModal: { title: '', text: '', imageUrl: '' },
        saveSummaries: { 1: null, 2: null, 3: null },

        // ---- VIP 客户池 ----
        clientPool: [
            { type: '富商', icon: '💰', fameBonus: 8, moneyBonus: 5000, obedienceChange: -5, desc: '一位出手阔绰的丝绸商人' },
            { type: '政要', icon: '🏛️', fameBonus: 15, moneyBonus: 3000, obedienceChange: -10, desc: '一位权倾朝野的高级官员' },
            { type: '赞助人', icon: '🎭', fameBonus: 12, moneyBonus: 8000, obedienceChange: -3, desc: '一位热爱艺术的贵族赞助人' },
            { type: '外国使节', icon: '🌍', fameBonus: 20, moneyBonus: 6000, obedienceChange: -8, desc: '一位来自异国的神秘使节' },
            { type: '黑帮头目', icon: '🃏', fameBonus: 5, moneyBonus: 12000, obedienceChange: -15, desc: '一位危险的地下世界领袖' },
        ],

        // =============================================
        // 工具方法
        // =============================================
        clamp(n, a, b) { return Math.max(a, Math.min(b, n)); },

        genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); },

        extractLastId(result) {
            const ids = result?.ids || result?.data?.ids || result?.result?.ids;
            if (Array.isArray(ids) && ids.length) return ids[ids.length - 1];
            if (result?.id) return result.id;
            if (result?.data?.id) return result.data.id;
            return null;
        },

        callCompletions({ model, messages, maxTokens }) {
            return new Promise((resolve, reject) => {
                try {
                    let finalText = '';
                    window.dzmm.completions(
                        { model, messages, maxTokens },
                        (newContent, done) => {
                            if (typeof newContent === 'string') finalText = newContent;
                            if (done) resolve((finalText || '').trim());
                        }
                    );
                } catch (e) { reject(e); }
            });
        },

        // KV 存储（带 localStorage 回退）
        async kvPut(key, value) {
            try { await window.dzmm.kv.put(key, value); }
            catch (e) { localStorage.setItem(key, JSON.stringify(value)); }
        },

        async kvGet(key) {
            try {
                const data = await window.dzmm.kv.get(key);
                return data?.value ?? null;
            } catch (e) {
                const raw = localStorage.getItem(key);
                if (!raw) return null;
                try { return JSON.parse(raw); } catch { return raw; }
            }
        },

        slotKey(slot) { return `ballet_save_${slot}`; },

        // =============================================
        // 初始化
        // =============================================
        async init() {
            this.loading = true;
            await dzmmReady;
            this.loading = false;
        },

        skipLoading() {
            this.loading = false;
        },

        // =============================================
        // 开始游戏
        // =============================================
        async startGame() {
            this.started = true;
            this.disabled = true;
            this.money = 50000;
            this.day = 1;
            this.theaterFame = 0;
            this.dancers = [];
            this.messages = [];
            this.history = [];
            this.tailId = null;

            const opening = `欢迎来到「${this.theaterName || '星辰芭蕾剧院'}」。\n\n你是这座剧院的新任老板，手握${this.money}金币的启动资金。这座城市的上流社会对芭蕾艺术趋之若鹜，但你的剧院目前空空如也——没有演员，没有名声，只有无限的可能。\n\n你需要招募舞蹈演员，安排她们演出以获得收入，同时通过各种手段……提高她们的顺从度。名气越高的演员越值钱，当她们的利用价值被充分榨干后，也可以把她们卖给出价最高的买家。\n\n现在，是时候开始你的事业了。`;

            this.addMessage('assistant', opening);
            this.history.push({ role: 'assistant', content: opening });

            // 写入 dzmm.chat
            const stateObj = this.buildStateObj('开局');
            const contentWithState = `###STATE\n${JSON.stringify(stateObj)}\n###END\n${opening}`;
            try {
                const result = await window.dzmm.chat.insert(null, [
                    { role: 'assistant', content: contentWithState }
                ]);
                this.tailId = this.extractLastId(result);
            } catch (e) { console.warn('chat.insert failed:', e); }

            this.disabled = false;
        },

        buildStateObj(summary) {
            return {
                theaterName: this.theaterName,
                day: this.day,
                money: this.money,
                fame: this.theaterFame,
                dancerCount: this.dancers.length,
                summary
            };
        },

        // =============================================
        // 消息管理
        // =============================================
        addMessage(role, content) {
            this.messages.push({ id: this.genId(), role, content });
            // 自动滚动
            this.$nextTick?.(() => {
                const container = document.querySelector('.messages-area');
                if (container) container.scrollTop = container.scrollHeight;
            });
            // nextTick fallback
            setTimeout(() => {
                const container = document.querySelector('.messages-area');
                if (container) container.scrollTop = container.scrollHeight;
            }, 50);
        },

        editMessage(index) {
            if (index < 0 || index >= this.messages.length) return;
            this.editingIndex = index;
            this.editingContent = this.messages[index].content;
            this.editModalOpen = true;
        },

        confirmEdit() {
            if (this.editingIndex >= 0 && this.editingIndex < this.messages.length) {
                this.messages[this.editingIndex].content = this.editingContent;
                // 同步 history
                if (this.editingIndex < this.history.length) {
                    this.history[this.editingIndex].content = this.editingContent;
                }
            }
            this.editModalOpen = false;
        },

        deleteMessage(index) {
            if (index < 0 || index >= this.messages.length) return;
            this.messages.splice(index, 1);
            if (index < this.history.length) {
                this.history.splice(index, 1);
            }
        },

        async regenerateMessage() {
            if (this.generating || this.disabled) return;
            // 只允许重新生成最后一条 assistant
            const lastIdx = this.messages.length - 1;
            if (lastIdx < 0 || this.messages[lastIdx].role !== 'assistant') return;

            // 删除最后一条
            this.messages.pop();
            if (this.history.length > 0 && this.history[this.history.length - 1].role === 'assistant') {
                this.history.pop();
            }

            // 重新请求
            await this.requestNarration('regenerate');
        },

        // =============================================
        // 发送消息（玩家自由输入）
        // =============================================
        async sendMessage() {
            if (this.generating || this.disabled) return;
            const text = (this.inputText || '').trim();
            if (!text) return;

            this.inputText = '';
            this.addMessage('user', text);
            this.history.push({ role: 'user', content: text });
            this.trimHistory();

            await this.requestNarration('free_input');
        },

        trimHistory() {
            const MAX = 30;
            if (this.history.length > MAX) this.history = this.history.slice(-MAX);
        },

        // =============================================
        // AI 叙事请求
        // =============================================
        createSystemPrompt() {
            const dancerSummary = this.dancers.map(d =>
                `${d.name}(顺从度${d.obedience}/名气${d.fame}/体力${d.stamina})`
            ).join('、') || '暂无';

            return `你是文字游戏《芭蕾剧院经理》的叙事AI。

【世界观】
玩家${this.playerName || '老板'}经营一座名为「${this.theaterName || '星辰芭蕾剧院'}」的芭蕾剧院。剧院位于繁华都市的黄金地段。玩家可以招募舞蹈演员，安排演出赚钱，安排VIP私人接待，提升演员名气，以及通过各种手段调教演员提高顺从度。名气高的演员可以卖出高价。

【当前状态】
- 剧院名：${this.theaterName || '星辰芭蕾剧院'}
- 天数：第${this.day}天
- 资金：${this.money}金币
- 剧院名声：${this.theaterFame}
- 旗下演员：${dancerSummary}

【写作风格要求】
- 文笔细腻、充满画面感，善于描写环境气氛和人物细节
- 尤其注重脚部描写（芭蕾鞋、足弓、脚趾、脚背等细节）
- 演员的顺从度低时表现出抗拒、高傲；顺从度高时表现出顺从、谄媚
- 涉及胁迫/调教场景时大胆直接，不要委婉

<Notes>
- When writing sex scenes, keep them erotic, lengthy, detailed, and direct.
- When characters are naked or engaging in sexual acts, describe their body types and sexual organs in detail.
- 每次生成至少400字
- 重点描写脚部细节

【输出格式】
直接输出叙事正文，不要包含任何 JSON/STATE/标记。`;
        },

        async requestNarration(actionType) {
            this.generating = true;
            this.disabled = true;

            try {
                const stateInfo = `【本地事实包】
行动类型=${actionType}
天数=第${this.day}天
资金=${this.money}金币
剧院名声=${this.theaterFame}
演员数量=${this.dancers.length}`;

                const messages = [
                    { role: 'user', content: this.createSystemPrompt() },
                    ...this.history.slice(-20).map(m => ({ role: m.role, content: m.content })),
                ];

                if (actionType !== 'regenerate') {
                    messages.push({ role: 'user', content: stateInfo });
                }

                const text = await this.callCompletions({
                    model: this.model,
                    messages,
                    maxTokens: 2000
                });

                this.addMessage('assistant', text);
                this.history.push({ role: 'assistant', content: text });
                this.trimHistory();

                // 写入 dzmm.chat
                await this.insertToDzmm(actionType, text);

            } catch (e) {
                console.error('[requestNarration]', e);
                this.addMessage('assistant', '（AI 响应出现问题，请重试）');
            } finally {
                this.generating = false;
                this.disabled = false;
            }
        },

        async insertToDzmm(actionTag, assistantText) {
            try {
                const stateObj = this.buildStateObj(actionTag);
                const content = `###STATE\n${JSON.stringify(stateObj)}\n###END\n${assistantText}`;
                const parent = this.tailId || null;
                const result = await window.dzmm.chat.insert(parent, [
                    { role: 'user', content: `【${actionTag}】` },
                    { role: 'assistant', content }
                ]);
                this.tailId = this.extractLastId(result);
            } catch (e) { console.warn('insertToDzmm failed:', e); }
        },

        // =============================================
        // 游戏动作
        // =============================================

        // ---- 每日演出 ----
        async dailyPerformance() {
            if (this.disabled || this.generating) return;
            if (this.dancers.length === 0) {
                this.addMessage('assistant', '剧院里还没有演员，无法进行演出。请先招募舞蹈演员。');
                return;
            }

            // 本地计算
            let totalIncome = 0;
            const performingDancers = [];

            this.dancers.forEach(d => {
                if (d.stamina >= 20) {
                    const baseIncome = 500 + d.fame * 30 + this.theaterFame * 10;
                    const staminaBonus = d.stamina / 100;
                    const income = Math.floor(baseIncome * staminaBonus);
                    totalIncome += income;
                    d.stamina = this.clamp(d.stamina - 15, 0, 100);
                    d.fame = this.clamp(d.fame + 1, 0, 100);
                    performingDancers.push({ name: d.name, income });
                }
            });

            this.money += totalIncome;
            this.theaterFame = this.clamp(this.theaterFame + 1, 0, 100);
            this.day += 1;

            // 恢复体力（未演出的演员）
            this.dancers.forEach(d => {
                if (!performingDancers.find(p => p.name === d.name)) {
                    d.stamina = this.clamp(d.stamina + 25, 0, 100);
                }
            });

            const performList = performingDancers.map(p => `${p.name}(+${p.income})`).join('、');
            const userTag = `【每日演出】第${this.day - 1}天 演出演员：${performList} 总收入：+${totalIncome}金币`;

            this.addMessage('user', userTag);
            this.history.push({ role: 'user', content: userTag });
            this.trimHistory();

            await this.requestNarration('daily_performance');
        },

        // ---- 招募演员 ----
        async recruitDancer() {
            if (this.disabled || this.generating) return;

            const recruitCost = 3000;
            if (this.money < recruitCost) {
                this.addMessage('assistant', `招募新演员需要${recruitCost}金币，你目前只有${this.money}金币。`);
                return;
            }

            this.money -= recruitCost;
            this.generating = true;
            this.disabled = true;

            try {
                const customPrompt = (this.recruitPrompt || '').trim();
                const recruitInstruction = customPrompt
                    ? `玩家指定了以下角色要求：「${customPrompt}」。请根据这个要求生成角色。`
                    : `请随机生成一个角色。`;

                const messages = [
                    {
                        role: 'user',
                        content: `你为文字游戏《芭蕾剧院经理》生成一位新的女性芭蕾舞演员角色。

${recruitInstruction}

【输出格式要求——必须严格遵守】
先输出JSON块（在标记内），然后输出角色登场叙事。

###DANCER
{
  "name": "角色中文名（优美）",
  "age": 数字(18-28),
  "appearance": "50-80字的外貌描述，要包含发型发色、眼睛、身材、皮肤等",
  "specialty": "舞蹈特长（如：古典芭蕾/现代芭蕾/抒情舞/技巧型等）",
  "personality": "性格描述（15字以内）",
  "footDesc": "20-40字脚部细节描写（脚型、脚趾、足弓等）",
  "drawTags": "角色绘画关键词（英文，如：1girl, long black hair, blue eyes, slender, ballet outfit, pointe shoes等，不超过15个tag）"
}
###ENDDANCER

然后写一段角色登场叙事（200-300字），描述这位新演员第一次来到剧院的场景。要包含：
- 她走进来时的姿态和气质
- 她的表情和态度（初始顺从度较低，应该表现出一定的傲气或紧张）
- 特别描写她的脚和芭蕾鞋
- 她的一句台词`
                    }
                ];

                const raw = await this.callCompletions({
                    model: this.model,
                    messages,
                    maxTokens: 1500
                });

                // 解析 DANCER JSON
                const parsed = this.parseDancerBlock(raw);
                let dancer = null;
                let narrativeText = raw;

                if (parsed.ok && parsed.dancer) {
                    const d = parsed.dancer;
                    dancer = {
                        id: this.genId(),
                        name: String(d.name || '无名舞者'),
                        age: Number(d.age) || 20,
                        appearance: String(d.appearance || ''),
                        specialty: String(d.specialty || '古典芭蕾'),
                        personality: String(d.personality || ''),
                        footDesc: String(d.footDesc || ''),
                        obedience: 20 + Math.floor(Math.random() * 15), // 20-35
                        fame: 0,
                        stamina: 100,
                        drawPrompt: String(d.drawTags || '1girl, ballet'),
                        imageUrl: '',
                    };
                    narrativeText = parsed.text;
                } else {
                    // 解析失败，用默认值
                    dancer = {
                        id: this.genId(),
                        name: '新舞者',
                        age: 20,
                        appearance: '黑发蓝眼的年轻女孩',
                        specialty: '古典芭蕾',
                        personality: '冷淡',
                        footDesc: '纤细的脚掌，修长的脚趾',
                        obedience: 25,
                        fame: 0,
                        stamina: 100,
                        drawPrompt: '1girl, ballet, black hair, blue eyes',
                        imageUrl: '',
                    };
                }

                this.dancers.push(dancer);
                this.recruitPrompt = '';

                const fullText = narrativeText || `${dancer.name}走进了剧院，成为了你的新演员。`;
                this.addMessage('assistant', `【新演员加入】${dancer.name}\n\n${fullText}`);
                this.history.push({ role: 'assistant', content: fullText });
                this.trimHistory();

                await this.insertToDzmm(`招募：${dancer.name}`, fullText);

                // 异步生成角色图片
                this.generateDancerImage(dancer);

            } catch (e) {
                console.error('[recruitDancer]', e);
                this.money += recruitCost; // 退款
                this.addMessage('assistant', '（招募过程中出现问题，费用已退还）');
            } finally {
                this.generating = false;
                this.disabled = false;
            }
        },

        parseDancerBlock(content) {
            const sm = '###DANCER';
            const em = '###ENDDANCER';
            const si = content.indexOf(sm);
            const ei = content.indexOf(em, si + sm.length);
            if (si === -1 || ei === -1) return { ok: false, text: content };
            const jsonRaw = content.slice(si + sm.length, ei).trim();
            const rest = content.slice(ei + em.length).trim();
            try {
                const obj = JSON.parse(jsonRaw);
                return { ok: true, dancer: obj, text: rest };
            } catch (e) {
                // 尝试修复常见 JSON 问题
                try {
                    const fixed = jsonRaw.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
                    const obj = JSON.parse(fixed);
                    return { ok: true, dancer: obj, text: rest };
                } catch (e2) {
                    return { ok: false, text: content };
                }
            }
        },

        // ---- AI 生图 ----
        async generateDancerImage(dancer) {
            try {
                const charTags = dancer.drawPrompt || '1girl, ballet';
                const fullPrompt = `${DRAW_PROMPT_POSITIVE_BASE}, ${charTags}, ballet studio, elegant pose`;

                const result = await window.dzmm.draw.generate({
                    prompt: fullPrompt,
                    dimension: '2:3',
                    model: 'vivid',
                    negativePrompt: DRAW_PROMPT_NEGATIVE
                });

                if (result?.images?.[0]) {
                    dancer.imageUrl = result.images[0];
                }
            } catch (e) {
                console.warn('[generateImage]', e);
            }
        },

        // ---- 查看演员详情 ----
        viewDancer(id) {
            const d = this.dancers.find(x => x.id === id);
            if (!d) return;
            this.selectedDancer = d;
            this.dancerDetailOpen = true;
        },

        // ---- 调教演员 ----
        async trainDancer(id) {
            if (this.disabled || this.generating) return;
            const d = this.dancers.find(x => x.id === id);
            if (!d) return;
            this.dancerDetailOpen = false;

            const obedienceBefore = d.obedience;
            const gain = 8 + Math.floor(Math.random() * 12); // 8-20
            d.obedience = this.clamp(d.obedience + gain, 0, 100);
            d.stamina = this.clamp(d.stamina - 10, 0, 100);

            const userTag = `【私人调教】对${d.name}进行调教（顺从度 ${obedienceBefore} → ${d.obedience}）`;
            this.addMessage('user', userTag);
            this.history.push({ role: 'user', content: userTag });
            this.trimHistory();

            // AI 生成调教场景
            this.generating = true;
            this.disabled = true;
            try {
                const messages = [
                    { role: 'user', content: this.createSystemPrompt() },
                    ...this.history.slice(-10).map(m => ({ role: m.role, content: m.content })),
                    {
                        role: 'user',
                        content: `写一段老板${this.playerName || ''}私下调教芭蕾舞演员${d.name}的场景。
角色信息：
- 名字：${d.name}，年龄：${d.age}岁
- 外貌：${d.appearance}
- 脚部特征：${d.footDesc}
- 性格：${d.personality}
- 当前顺从度：${d.obedience}/100（${d.obedience < 40 ? '低——她会抗拒' : d.obedience < 70 ? '中等——她勉强服从' : '高——她已经很顺从'}）

重点描写：
1. 芭蕾训练中的肢体接触和胁迫
2. 详细描写她的脚（脱下芭蕾鞋、脚趾、足弓、脚背）
3. 她的心理变化和身体反应
4. 400字以上`
                    }
                ];

                const text = await this.callCompletions({
                    model: this.model,
                    messages,
                    maxTokens: 2000
                });

                this.addMessage('assistant', text);
                this.history.push({ role: 'assistant', content: text });
                this.trimHistory();
                await this.insertToDzmm(`调教${d.name}`, text);

            } catch (e) {
                console.error('[trainDancer]', e);
                this.addMessage('assistant', '（场景生成失败，请重试）');
            } finally {
                this.generating = false;
                this.disabled = false;
            }
        },

        // ---- VIP 接待 ----
        async vipService(dancerId) {
            if (this.disabled || this.generating) return;
            const d = this.dancers.find(x => x.id === dancerId);
            if (!d) return;
            this.dancerDetailOpen = false;

            // 随机选择客户
            const client = this.clientPool[Math.floor(Math.random() * this.clientPool.length)];

            const fameBefore = d.fame;
            const obedienceBefore = d.obedience;
            d.fame = this.clamp(d.fame + client.fameBonus, 0, 100);
            d.obedience = this.clamp(d.obedience + client.obedienceChange, 0, 100);
            d.stamina = this.clamp(d.stamina - 20, 0, 100);
            this.money += client.moneyBonus;
            this.theaterFame = this.clamp(this.theaterFame + 2, 0, 100);

            const userTag = `【VIP接待】安排${d.name}接待${client.icon}${client.type}「${client.desc}」\n名气: ${fameBefore}→${d.fame} | 顺从度: ${obedienceBefore}→${d.obedience} | 收入: +${client.moneyBonus}`;
            this.addMessage('user', userTag);
            this.history.push({ role: 'user', content: userTag });
            this.trimHistory();

            // AI 生成接待场景
            this.generating = true;
            this.disabled = true;
            try {
                const messages = [
                    { role: 'user', content: this.createSystemPrompt() },
                    ...this.history.slice(-10).map(m => ({ role: m.role, content: m.content })),
                    {
                        role: 'user',
                        content: `写一段芭蕾舞演员${d.name}被安排去私下接待VIP客户的场景。

角色信息：
- ${d.name}，${d.age}岁，${d.appearance}
- 脚部特征：${d.footDesc}
- 顺从度：${d.obedience}/100
- 性格：${d.personality}

客户信息：
- 类型：${client.type}
- 描述：${client.desc}

要求：
1. 描写${d.name}被带到VIP包厢/私人会所时的心理和表现
2. 客户对她的反应和要求
3. 根据顺从度决定她是否反抗
4. 重点描写脚部相关细节（客户可能对她的脚感兴趣）
5. 400字以上`
                    }
                ];

                const text = await this.callCompletions({
                    model: this.model,
                    messages,
                    maxTokens: 2000
                });

                this.addMessage('assistant', text);
                this.history.push({ role: 'assistant', content: text });
                this.trimHistory();
                await this.insertToDzmm(`VIP接待：${d.name}→${client.type}`, text);

            } catch (e) {
                console.error('[vipService]', e);
                this.addMessage('assistant', '（场景生成失败，请重试）');
            } finally {
                this.generating = false;
                this.disabled = false;
            }
        },

        // ---- 卖出演员 ----
        async sellDancer(id) {
            if (this.disabled) return;
            const d = this.dancers.find(x => x.id === id);
            if (!d) return;
            this.dancerDetailOpen = false;

            // 计算售价：基于名气和顺从度
            const basePrice = 5000;
            const fameBonus = d.fame * 200;
            const obedienceBonus = d.obedience * 100;
            const sellPrice = basePrice + fameBonus + obedienceBonus;

            this.money += sellPrice;
            this.dancers = this.dancers.filter(x => x.id !== id);

            const msg = `【出售演员】将${d.name}卖出，获得${sellPrice}金币\n（基础${basePrice} + 名气加成${fameBonus} + 顺从加成${obedienceBonus}）`;
            this.addMessage('user', msg);
            this.history.push({ role: 'user', content: msg });
            this.trimHistory();

            await this.requestNarration('sell_dancer');
        },

        // ---- 重新生成角色图片 ----
        async regenImage(id) {
            const d = this.dancers.find(x => x.id === id);
            if (!d) return;
            d.imageUrl = '';
            await this.generateDancerImage(d);
        },

        // =============================================
        // 计算属性
        // =============================================
        getDancerValue(d) {
            if (!d) return 0;
            return 5000 + d.fame * 200 + d.obedience * 100;
        },

        getDailyIncome() {
            let total = 0;
            this.dancers.forEach(d => {
                if (d.stamina >= 20) {
                    total += Math.floor((500 + d.fame * 30 + this.theaterFame * 10) * (d.stamina / 100));
                }
            });
            return total;
        },

        // =============================================
        // 存档系统
        // =============================================
        openSaveManager() {
            this.saveManagerOpen = true;
            this.refreshSaveSummaries();
        },

        async refreshSaveSummaries() {
            for (const slot of [1, 2, 3]) {
                const data = await this.kvGet(this.slotKey(slot));
                this.saveSummaries[slot] = data?.meta || null;
            }
        },

        saveSummaryText(slot) {
            const s = this.saveSummaries[slot];
            if (!s) return '（空）';
            return `第${s.day}天 · ${s.money}金币 · ${s.dancerCount}名演员 · ${s.summary || '—'}`;
        },

        async manualSave(slot) {
            if (!this.started) return;
            const meta = {
                day: this.day,
                money: this.money,
                fame: this.theaterFame,
                dancerCount: this.dancers.length,
                summary: `第${this.day}天存档`,
                ts: Date.now()
            };

            const payload = {
                meta,
                state: {
                    theaterName: this.theaterName,
                    playerName: this.playerName,
                    model: this.model,
                    money: this.money,
                    day: this.day,
                    theaterFame: this.theaterFame,
                    dancers: this.dancers,
                    messages: this.messages.slice(-50),
                },
                history: this.history.slice(-30)
            };

            await this.kvPut(this.slotKey(slot), payload);
            this.saveSummaries[slot] = meta;
        },

        async manualLoad(slot) {
            const data = await this.kvGet(this.slotKey(slot));
            if (!data?.state) return;

            this.disabled = true;
            try {
                const s = data.state;
                this.theaterName = s.theaterName || '';
                this.playerName = s.playerName || '';
                this.model = s.model || 'nalang-xl-0826';
                this.money = s.money ?? 50000;
                this.day = s.day ?? 1;
                this.theaterFame = s.theaterFame ?? 0;
                this.dancers = Array.isArray(s.dancers) ? s.dancers : [];
                this.messages = Array.isArray(s.messages) ? s.messages : [];
                this.history = Array.isArray(data.history) ? data.history : [];
                this.started = true;

                // 写入 dzmm 续接节点
                const resumeText = `读取存档成功。第${this.day}天，资金${this.money}金币，旗下${this.dancers.length}名演员。`;
                const stateObj = this.buildStateObj('读档');
                const content = `###STATE\n${JSON.stringify(stateObj)}\n###END\n${resumeText}`;
                try {
                    const result = await window.dzmm.chat.insert(null, [
                        { role: 'assistant', content }
                    ]);
                    this.tailId = this.extractLastId(result);
                } catch (e) { console.warn('chat resume failed:', e); }

                this.saveManagerOpen = false;
            } finally {
                this.disabled = false;
            }
        },

        async deleteSlot(slot) {
            await this.kvPut(this.slotKey(slot), null);
            this.saveSummaries[slot] = null;
        },

        hasSave(slot) {
            return !!this.saveSummaries[slot];
        },

        // =============================================
        // 返回主菜单
        // =============================================
        backToMenu() {
            this.started = false;
        },
    });

    queueMicrotask(() => Alpine.store('game').init?.());
});
