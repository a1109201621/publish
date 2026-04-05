/**
 * 芭蕾剧院 - Ballet Theater Tycoon
 *
 * 使用 DZMM SDK (completions / draw / kv / chat) 实现
 * - AI 叙事（流式）
 * - AI 生图（3D 串）
 * - 持久化存档（dzmm.kv）
 * - 消息编辑/删除/重新生成（dzmm.chat）
 */

// ── DZMM SDK 就绪 ──
if (window.parent !== window) {
    window.parent.postMessage('iframe:content-ready', '*');
}

const dzmmReady = new Promise((resolve) => {
    if (window.dzmm) { resolve(); return; }
    window.addEventListener('message', function handler(e) {
        if (e.data?.type === 'dzmm:ready') {
            window.removeEventListener('message', handler);
            resolve();
        }
    });
    // 超时回退
    setTimeout(resolve, 5000);
});

// ── 3D 提示词串 ──
const DRAW_POSITIVE_BASE = `best quality, masterpiece, realistic, 2.00::3D ::, 1.20::Artist:jagercoke ::, 1.40::Artist:yinse_qi_ji ::, 1.50::Artist:nixeu ::, 0.50::Artist:ria_(baka-neearts) ::, 1.40::artist:seven_(sixplusone) ::, very aesthetic, masterpiece, no text, photorealistic, hyperrealistic, realistic skin texture, skin pores, volumetric lighting, soft shadows, detailed eyes with reflections, eyelash details, 8k, sharp focus, depth of field`;
const DRAW_NEGATIVE_BASE = `low quality, worst quality, anime, cartoon, painting, drawing, oversaturated, deformed hands, extra fingers, mutated hands, unnatural lighting, unrealistic eyes, plastic skin, doll-like, symmetry, blurry background, poorly drawn face, text, watermark, abstract background, low resolution`;

// ── 名字池 ──
const NAME_POOL = [
    '安娜', '伊莲娜', '娜塔莎', '奥莉维亚', '索菲亚', '维多利亚',
    '叶卡捷琳娜', '阿丽莎', '玛利亚', '伊莎贝拉', '薇拉', '安吉丽娜',
    '达莉亚', '斯维特兰娜', '柳德米拉', '加琳娜', '尤利娅', '塔玛拉',
    '丽莎', '克拉拉', '伊芙琳', '罗莎', '塞西莉亚', '弗洛伦斯'
];

// ── 外貌特征池 ──
const HAIR_POOL = ['黑色长发', '金色波浪卷发', '银白色直发', '红棕色短发', '栗色马尾', '铂金色双马尾', '深紫色及腰长发', '蜜色小卷发'];
const EYES_POOL = ['深邃的蓝色眼睛', '明亮的琥珀色眼睛', '清冷的灰色眼睛', '温柔的棕色眼睛', '翠绿色的猫眼', '深紫色的神秘眼瞳'];
const BODY_POOL = ['修长纤细的身材', '丰满圆润的身材', '匀称健美的身材', '娇小玲珑的身材', '高挑优雅的身材'];
const FEET_POOL = ['纤细白皙的双足，脚趾修长而优美', '小巧精致的足部，脚背线条优雅', '白嫩的脚掌带着淡淡的粉红，足弓弧度完美', '修长的双足如白玉般润泽，趾甲泛着珍珠光泽'];
const SKIN_POOL = ['白皙如瓷', '蜜色肌肤', '象牙白的肤色', '带有淡淡雀斑的肌肤', '通透莹润的肌肤'];

// ── 客户类型 ──
const CLIENT_TYPES = [
    { id: 'merchant', name: '富商', icon: '💰', fameGain: 5, obedienceChange: [-5, 5], reward: 500, desc: '出手阔绰的商人' },
    { id: 'noble', name: '贵族', icon: '👑', fameGain: 10, obedienceChange: [-8, 3], reward: 800, desc: '身份尊贵的贵族' },
    { id: 'politician', name: '政要', icon: '🏛️', fameGain: 15, obedienceChange: [-10, 2], reward: 1200, desc: '手握权势的政要' },
    { id: 'patron', name: '赞助人', icon: '🎭', fameGain: 8, obedienceChange: [-3, 8], reward: 600, desc: '热爱艺术的赞助人' },
];

// ── 互动类型 ──
const INTERACT_TYPES = [
    { id: 'train', name: '训练', icon: '🩰', obedienceGain: 3, desc: '严格的舞蹈训练' },
    { id: 'punish', name: '惩罚', icon: '⛓️', obedienceGain: 8, desc: '让她学会服从' },
    { id: 'foot_worship', name: '足部侍奉', icon: '🦶', obedienceGain: 5, desc: '让她用双足服侍你' },
    { id: 'private', name: '私下玩弄', icon: '🔞', obedienceGain: 10, desc: '在私密房间里…' },
];

document.addEventListener('alpine:init', () => {
    Alpine.store('game', {
        // ==================== 基础状态 ====================
        loading: true,
        started: false,
        disabled: false,
        generating: false,
        generatingContent: '',

        // ==================== 玩家配置 ====================
        playerName: '',
        theaterName: '',
        model: 'nalang-xl-0826',

        // ==================== 游戏数据 ====================
        funds: 10000,
        day: 1,
        dancers: [],
        messages: [],
        chat_content: '',
        lastParentId: null,

        // ==================== 输入 ====================
        inputText: '',

        // ==================== UI 状态 ====================
        saveManagerOpen: false,
        editModalOpen: false,
        editingIndex: -1,
        editingContent: '',
        dancerDetailOpen: false,
        selectedDancerId: null,
        imageModalOpen: false,
        imageModalUrl: '',
        imageModalLoading: false,
        recruitModalOpen: false,

        // ==================== 初始化 ====================
        async init() {
            this.loading = true;
            try {
                await dzmmReady;
                await this.restoreProgress();
            } catch (e) {
                console.warn('初始化失败:', e);
            }
            // 2秒超时保底
            setTimeout(() => { this.loading = false; }, 2000);
        },

        skipLoading() {
            this.loading = false;
        },

        // ==================== 游戏开始 ====================
        async startGame() {
            if (!this.playerName) return;
            this.funds = 10000;
            this.day = 1;
            this.dancers = [];
            this.messages = [];
            this.chat_content = '';
            this.lastParentId = null;
            this.started = true;
            this.loading = false;

            // 初始叙事
            await this.requestAIResponse('', true);
        },

        // ==================== 系统提示词 ====================
        createSystemPrompt() {
            const dancerList = this.dancers.map(d =>
                `[${d.name}] 顺从度:${d.obedience}/100 名气:${d.fame}/100 外貌:${d.appearance} 足部:${d.feet}`
            ).join('\n') || '暂无演员';

            return `你是一个成人文字冒险游戏的旁白/叙述者。游戏背景为一个地下芭蕾剧院。

当前状态：
玩家名：${this.playerName}
剧院名：${this.theaterName || '无名剧院'}
资金：${this.funds} 金币
天数：第 ${this.day} 天
当前演员：
${dancerList}

【重要格式要求】
每次回复必须按以下模板：

###STATE
{"funds_change":数字,"obedience_changes":{"演员名":变化值},"fame_changes":{"演员名":变化值},"new_day":true或false,"summary":"摘要"}
###END

（这里写详细的叙事内容）

规则：
1. 前三行必须是 ###STATE、JSON、###END
2. JSON 必须在一行内
3. funds_change 是金币变化量（正数增加，负数减少）
4. obedience_changes 和 fame_changes 是对应演员名的属性变化
5. new_day 表示是否推进到新的一天
6. ###END 之后才写叙事内容

【写作风格】
- 这是一个R18成人游戏，包含胁迫、支配等内容
- 详细描写演员的外貌、身体，尤其是脚部（脚趾、足弓、脚掌、脚踝等）
- 舞蹈训练场景要描写她们赤足或穿芭蕾舞鞋的细节
- 接待客户时描写演员的顺从或抗拒
- 营造权力掌控的氛围
- 文字优美但带有色情暗示或直白的色情描写
- 每次叙事 200~400 字`;
        },

        // ==================== AI 对话 ====================
        async requestAIResponse(userMessage, isStart = false) {
            this.disabled = true;
            this.generating = true;
            this.generatingContent = '';
            let content = '';

            try {
                // 构建 messages
                let chatHistory = [];
                try {
                    chatHistory = await window.dzmm.chat.list();
                } catch (e) { console.warn('读取历史失败:', e); }

                const messages = [
                    { role: 'user', content: this.createSystemPrompt() },
                    ...chatHistory.map(m => ({ role: m.role, content: m.content }))
                ];

                if (isStart) {
                    messages.push({ role: 'user', content: '游戏开始。描述剧院的清晨，你作为老板走进这座地下芭蕾剧院的场景。' });
                } else if (userMessage) {
                    messages.push({ role: 'user', content: userMessage });
                }

                await window.dzmm.completions(
                    { model: this.model, messages, maxTokens: 2000 },
                    async (newContent, done) => {
                        content = newContent;
                        const parsed = this.parseAIResponse(content);

                        if (parsed.ready) {
                            this.updateGameState(parsed.state);
                            this.chat_content = this.formatContent(parsed.dialogue);
                        } else {
                            this.generatingContent = content;
                        }

                        if (done && content) {
                            // 保存消息到 chat
                            const toSave = [];
                            if (userMessage && !isStart) {
                                toSave.push({ role: 'user', content: userMessage });
                            } else if (isStart) {
                                toSave.push({ role: 'user', content: '【游戏开始】' });
                            }
                            toSave.push({ role: 'assistant', content });

                            try {
                                const result = await window.dzmm.chat.insert(null, toSave);
                                if (result?.ids) {
                                    this.lastParentId = result.ids[result.ids.length - 1];
                                }
                            } catch (e) { console.warn('保存消息失败:', e); }

                            // 更新本地 messages 显示
                            if (userMessage && !isStart) {
                                this.messages.push({
                                    id: Date.now() - 1,
                                    role: 'user',
                                    content: userMessage
                                });
                            }
                            this.messages.push({
                                id: Date.now(),
                                role: 'assistant',
                                content: content
                            });

                            this.autoSave();
                            this.scrollToBottom();
                        }
                    }
                );
            } catch (e) {
                console.error('AI 请求失败:', e);
                this.chat_content = `<span style="color:var(--rose)">请求失败: ${e.message}</span>`;
            } finally {
                this.disabled = false;
                this.generating = false;
                this.generatingContent = '';
            }
        },

        // ==================== 解析 AI 回复 ====================
        parseAIResponse(content) {
            const stateStart = content.indexOf('###STATE');
            const stateEnd = content.indexOf('###END', stateStart + 8);

            if (stateStart === -1 || stateEnd === -1) {
                return { ready: false };
            }

            const jsonRaw = content.slice(stateStart + 8, stateEnd).trim();
            try {
                const state = JSON.parse(jsonRaw);
                const dialogue = content.slice(stateEnd + 6).trim();
                return { ready: true, state, dialogue };
            } catch {
                return { ready: false };
            }
        },

        // ==================== 更新游戏状态 ====================
        updateGameState(state) {
            if (typeof state.funds_change === 'number') {
                this.funds = Math.max(0, this.funds + state.funds_change);
            }

            if (state.obedience_changes) {
                for (const [name, delta] of Object.entries(state.obedience_changes)) {
                    const d = this.dancers.find(x => x.name === name);
                    if (d) d.obedience = Math.max(0, Math.min(100, d.obedience + delta));
                }
            }

            if (state.fame_changes) {
                for (const [name, delta] of Object.entries(state.fame_changes)) {
                    const d = this.dancers.find(x => x.name === name);
                    if (d) d.fame = Math.max(0, Math.min(100, d.fame + delta));
                }
            }

            if (state.new_day) {
                this.day++;
                // 每日演出收入
                let dailyIncome = 0;
                this.dancers.forEach(d => {
                    dailyIncome += d.dailyIncome + Math.floor(d.fame * 5);
                });
                this.funds += dailyIncome;
            }
        },

        formatContent(text) {
            if (!text) return '';
            return text.replace(/\n/g, '<br>');
        },

        // ==================== 发送消息 ====================
        async sendMessage() {
            if (!this.inputText.trim() || this.disabled) return;
            const msg = this.inputText.trim();
            this.inputText = '';
            await this.requestAIResponse(msg);
        },

        // ==================== 消息管理 ====================
        editMessage(index) {
            this.editingIndex = index;
            this.editingContent = this.messages[index].content;
            // 去掉 STATE 块只编辑文字
            const parsed = this.parseAIResponse(this.editingContent);
            if (parsed.ready) {
                this.editingContent = parsed.dialogue;
            }
            this.editModalOpen = true;
        },

        confirmEdit() {
            if (this.editingIndex >= 0 && this.editingIndex < this.messages.length) {
                this.messages[this.editingIndex].content = this.editingContent;
                this.autoSave();
            }
            this.editModalOpen = false;
            this.editingIndex = -1;
            this.editingContent = '';
        },

        deleteMessage(index) {
            if (confirm('确定要删除这条消息吗？')) {
                this.messages.splice(index, 1);
                this.autoSave();
            }
        },

        async regenerateMessage() {
            if (this.messages.length === 0 || this.generating) return;
            // 移除最后一条 assistant 消息
            if (this.messages[this.messages.length - 1].role === 'assistant') {
                this.messages.pop();
            }
            // 找最后一条 user 消息
            let trigger = '继续描述当前场景';
            for (let i = this.messages.length - 1; i >= 0; i--) {
                if (this.messages[i].role === 'user') {
                    trigger = this.messages[i].content;
                    break;
                }
            }
            await this.requestAIResponse(trigger);
        },

        getDisplayContent(msg) {
            if (msg.role === 'user') return this.formatContent(msg.content);
            const parsed = this.parseAIResponse(msg.content);
            if (parsed.ready) return this.formatContent(parsed.dialogue);
            return this.formatContent(msg.content);
        },

        // ==================== 行动系统 ====================
        // 推进一天
        async actNextDay() {
            await this.requestAIResponse(`推进到第 ${this.day + 1} 天。描述今日的演出情况和剧院中发生的事情。`);
        },

        // 招募演员
        async actRecruit() {
            if (this.funds < 1000) {
                alert('资金不足！招募需要至少1000金币。');
                return;
            }
            this.disabled = true;

            // 随机生成角色
            const dancer = this.generateRandomDancer();
            this.funds -= 1000;
            this.dancers.push(dancer);

            // AI 叙事
            await this.requestAIResponse(
                `你花费了1000金币招募了一位新的舞蹈演员：${dancer.name}。
她的外貌：${dancer.appearance}，${dancer.hair}，${dancer.eyes}，${dancer.skin}。
她的双足：${dancer.feet}。
描述她第一次来到剧院的场景，重点描写她的外貌和赤足走在冰冷地板上的细节。`
            );

            // 尝试生成角色图片
            this.generateDancerImage(dancer);
        },

        // 生成随机角色
        generateRandomDancer() {
            const usedNames = new Set(this.dancers.map(d => d.name));
            let name = NAME_POOL[Math.floor(Math.random() * NAME_POOL.length)];
            while (usedNames.has(name) && usedNames.size < NAME_POOL.length) {
                name = NAME_POOL[Math.floor(Math.random() * NAME_POOL.length)];
            }

            const hair = HAIR_POOL[Math.floor(Math.random() * HAIR_POOL.length)];
            const eyes = EYES_POOL[Math.floor(Math.random() * EYES_POOL.length)];
            const body = BODY_POOL[Math.floor(Math.random() * BODY_POOL.length)];
            const feet = FEET_POOL[Math.floor(Math.random() * FEET_POOL.length)];
            const skin = SKIN_POOL[Math.floor(Math.random() * SKIN_POOL.length)];
            const age = 18 + Math.floor(Math.random() * 10);

            // 绘画提示词
            const hairEn = {
                '黑色长发': 'black long hair',
                '金色波浪卷发': 'blonde wavy curly hair',
                '银白色直发': 'silver white straight hair',
                '红棕色短发': 'auburn short hair',
                '栗色马尾': 'chestnut ponytail',
                '铂金色双马尾': 'platinum blonde twintails',
                '深紫色及腰长发': 'dark purple waist-length hair',
                '蜜色小卷发': 'honey colored small curls'
            };

            const eyesEn = {
                '深邃的蓝色眼睛': 'deep blue eyes',
                '明亮的琥珀色眼睛': 'bright amber eyes',
                '清冷的灰色眼睛': 'cool grey eyes',
                '温柔的棕色眼睛': 'warm brown eyes',
                '翠绿色的猫眼': 'emerald green cat eyes',
                '深紫色的神秘眼瞳': 'mysterious dark purple eyes'
            };

            const drawPrompt = `1girl, solo, ballet dancer, ${hairEn[hair] || 'long hair'}, ${eyesEn[eyes] || 'beautiful eyes'}, ballet outfit, leotard, elegant pose, ballet studio, ornate interior, golden chandeliers, bare feet, detailed feet, beautiful toes, arched foot, smooth skin, ${age} years old`;

            return {
                id: Date.now() + Math.random(),
                name,
                age,
                hair,
                eyes,
                body,
                feet,
                skin,
                appearance: `${age}岁，${body}，${hair}，${eyes}，${skin}`,
                obedience: 30 + Math.floor(Math.random() * 20),
                fame: Math.floor(Math.random() * 10),
                dailyIncome: 80 + Math.floor(Math.random() * 40),
                drawPrompt,
                imageUrl: '',
                status: 'idle'
            };
        },

        // 生成演员图片
        async generateDancerImage(dancer) {
            try {
                const result = await window.dzmm.draw.generate({
                    prompt: `${DRAW_POSITIVE_BASE}, ${dancer.drawPrompt}`,
                    dimension: '2:3',
                    negativePrompt: DRAW_NEGATIVE_BASE
                });
                if (result?.images?.[0]) {
                    dancer.imageUrl = result.images[0];
                    this.autoSave();
                }
            } catch (e) {
                console.warn('生图失败:', e);
            }
        },

        // 安排接待客户
        async actEntertainClient(clientType) {
            const dancer = this.getSelectedDancer();
            if (!dancer) { alert('请先选择一位演员'); return; }

            const client = CLIENT_TYPES.find(c => c.id === clientType);
            if (!client) return;

            this.funds += client.reward;

            await this.requestAIResponse(
                `安排演员 ${dancer.name} 接待一位${client.name}（${client.desc}）。
描述${dancer.name}如何用身体和舞蹈来取悦这位${client.name}。
要详细描写她的身体接触细节，尤其是脚部细节——她用纤细的脚趾怎样...
最后描述这位${client.name}对${dancer.name}的评价和额外打赏。
名气变化：+${client.fameGain}，收入：${client.reward}金币`
            );
        },

        // 与演员互动
        async actInteract(interactType) {
            const dancer = this.getSelectedDancer();
            if (!dancer) { alert('请先选择一位演员'); return; }

            const action = INTERACT_TYPES.find(a => a.id === interactType);
            if (!action) return;

            await this.requestAIResponse(
                `你对演员 ${dancer.name} 进行了"${action.name}"。${action.desc}。
详细描写这个过程，特别是她的身体反应和脚部细节。
当前顺从度：${dancer.obedience}/100，这次互动应该使顺从度提升约 ${action.obedienceGain} 点。`
            );
        },

        // 出售演员
        async actSellDancer() {
            const dancer = this.getSelectedDancer();
            if (!dancer) return;

            const price = Math.floor(500 + dancer.fame * 50 + dancer.obedience * 20);
            if (!confirm(`确定出售 ${dancer.name} 吗？\n预估售价：${price} 金币\n（名气越高越值钱）`)) return;

            this.funds += price;
            this.dancers = this.dancers.filter(d => d.id !== dancer.id);
            this.selectedDancerId = null;
            this.dancerDetailOpen = false;

            await this.requestAIResponse(
                `你以 ${price} 金币的价格出售了演员 ${dancer.name}。
描写买家带走她的场景，以及她离开剧院时的最后一眼。`
            );
        },

        // 生图 - 场景
        async actGenerateSceneImage() {
            const dancer = this.getSelectedDancer();
            if (!dancer) { alert('请先选择一位演员'); return; }

            this.imageModalOpen = true;
            this.imageModalLoading = true;
            this.imageModalUrl = '';

            try {
                const scenePrompts = [
                    `ballet performance, stage, spotlight, elegant dance pose, bare feet on stage`,
                    `ballet studio, mirror, barre, stretching pose, bare feet, wooden floor`,
                    `private room, luxurious, sitting on velvet chair, crossed legs, bare feet`,
                    `backstage, chandelier, standing pose, removing ballet shoes, bare feet visible`,
                ];
                const scene = scenePrompts[Math.floor(Math.random() * scenePrompts.length)];

                const result = await window.dzmm.draw.generate({
                    prompt: `${DRAW_POSITIVE_BASE}, ${dancer.drawPrompt}, ${scene}`,
                    dimension: '2:3',
                    negativePrompt: DRAW_NEGATIVE_BASE
                });

                if (result?.images?.[0]) {
                    this.imageModalUrl = result.images[0];
                    dancer.imageUrl = result.images[0];
                    this.autoSave();
                }
            } catch (e) {
                console.warn('生图失败:', e);
                this.imageModalUrl = '';
            } finally {
                this.imageModalLoading = false;
            }
        },

        // ==================== 辅助方法 ====================
        getSelectedDancer() {
            return this.dancers.find(d => d.id === this.selectedDancerId) || null;
        },

        selectDancer(id) {
            this.selectedDancerId = id;
        },

        openDancerDetail(id) {
            this.selectedDancerId = id;
            this.dancerDetailOpen = true;
        },

        getDancerSellPrice(dancer) {
            if (!dancer) return 0;
            return Math.floor(500 + dancer.fame * 50 + dancer.obedience * 20);
        },

        getDailyIncome() {
            let total = 0;
            this.dancers.forEach(d => {
                total += d.dailyIncome + Math.floor(d.fame * 5);
            });
            return total;
        },

        // ==================== 存档系统 (dzmm.kv) ====================
        async autoSave() {
            try {
                const saveData = {
                    timestamp: Date.now(),
                    playerName: this.playerName,
                    theaterName: this.theaterName,
                    model: this.model,
                    funds: this.funds,
                    day: this.day,
                    dancers: this.dancers,
                    messages: this.messages.slice(-30), // 只保留最近30条
                    lastParentId: this.lastParentId
                };
                await window.dzmm.kv.put('autosave', saveData);
            } catch (e) {
                console.warn('自动保存失败:', e);
            }
        },

        async manualSave(slot) {
            try {
                const saveData = {
                    timestamp: Date.now(),
                    playerName: this.playerName,
                    theaterName: this.theaterName,
                    model: this.model,
                    funds: this.funds,
                    day: this.day,
                    dancers: this.dancers,
                    messages: this.messages.slice(-30),
                    lastParentId: this.lastParentId
                };
                await window.dzmm.kv.put(`save_${slot}`, saveData);
                alert('保存成功！');
            } catch (e) {
                alert('保存失败: ' + e.message);
            }
        },

        async manualLoad(slot) {
            try {
                const result = await window.dzmm.kv.get(`save_${slot}`);
                if (!result?.value) {
                    alert('该存档位为空！');
                    return;
                }
                this.applySaveData(result.value);
                this.saveManagerOpen = false;
                alert('读取成功！');
            } catch (e) {
                alert('读取失败: ' + e.message);
            }
        },

        async deleteSave(slot) {
            if (!confirm('确定删除该存档吗？')) return;
            try {
                await window.dzmm.kv.delete(`save_${slot}`);
                alert('已删除');
            } catch (e) {
                alert('删除失败: ' + e.message);
            }
        },

        async getSaveInfo(slot) {
            try {
                const result = await window.dzmm.kv.get(`save_${slot}`);
                if (!result?.value) return '（空）';
                const s = result.value;
                const date = new Date(s.timestamp).toLocaleString();
                return `${s.playerName} · 第${s.day}天 · ${s.funds}金币 · ${s.dancers?.length || 0}人 · ${date}`;
            } catch {
                return '（空）';
            }
        },

        applySaveData(data) {
            this.playerName = data.playerName || '';
            this.theaterName = data.theaterName || '';
            this.model = data.model || 'nalang-xl-0826';
            this.funds = data.funds || 10000;
            this.day = data.day || 1;
            this.dancers = data.dancers || [];
            this.messages = data.messages || [];
            this.lastParentId = data.lastParentId || null;
            this.started = true;

            // 恢复最后的叙事
            if (this.messages.length > 0) {
                const lastAssistant = [...this.messages].reverse().find(m => m.role === 'assistant');
                if (lastAssistant) {
                    const parsed = this.parseAIResponse(lastAssistant.content);
                    if (parsed.ready) {
                        this.chat_content = this.formatContent(parsed.dialogue);
                    } else {
                        this.chat_content = this.formatContent(lastAssistant.content);
                    }
                }
            }
        },

        async restoreProgress() {
            try {
                const result = await window.dzmm.kv.get('autosave');
                if (result?.value) {
                    this.applySaveData(result.value);
                }
            } catch (e) {
                console.warn('读取自动存档失败:', e);
            }
            this.loading = false;
        },

        // 加载存档 slot 信息（用于显示）
        saveSlotInfo: { 1: '（空）', 2: '（空）', 3: '（空）' },

        async loadSaveSlotInfos() {
            for (let i = 1; i <= 3; i++) {
                this.saveSlotInfo[i] = await this.getSaveInfo(i);
            }
        },

        async openSaveManager() {
            this.saveManagerOpen = true;
            await this.loadSaveSlotInfos();
        },

        // ==================== 返回主菜单 ====================
        backToMenu() {
            if (confirm('确定返回主菜单吗？进度已自动保存。')) {
                this.autoSave();
                this.started = false;
            }
        },

        // ==================== 滚动到底部 ====================
        scrollToBottom() {
            setTimeout(() => {
                const container = document.querySelector('.messages-container');
                if (container) container.scrollTop = container.scrollHeight;
            }, 50);
        }
    });

    queueMicrotask(() => Alpine.store('game').init?.());
});
