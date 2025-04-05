import {
  App,
  Editor,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
} from "obsidian";

// Anki卡片接口
interface AnkiCard {
  question: string;
  answer: string;
  annotation?: string;
  tags?: string[];
}

// 默认设置
interface AnkifySettings {
  // API设置
  apiModel: string; // 选择的API模型
  deepseekApiKey: string;
  openaiApiKey: string;
  claudeApiKey: string;
  // 通用设置
  customPrompt: string;
  insertToDocument: boolean; // 是否直接插入文档而不是弹窗
  ankiConnectUrl: string; // Anki Connect API地址
  defaultDeck: string; // 默认牌组
  defaultNoteType: string; // 默认笔记类型
}

const DEFAULT_SETTINGS: AnkifySettings = {
  // API设置
  apiModel: "deepseek", // 默认使用DeepSeek
  deepseekApiKey: "",
  openaiApiKey: "",
  claudeApiKey: "",
  // 通用设置
  customPrompt:
    '请基于以下内容创建Anki卡片，格式为"问题:::答案"，每个卡片一行。提取关键概念和知识点。\n\n',
  insertToDocument: false, // 默认使用弹窗
  ankiConnectUrl: "http://127.0.0.1:8765", // Anki Connect默认地址
  defaultDeck: "Default", // 默认牌组
  defaultNoteType: "Basic", // 默认笔记类型
};

export default class AnkifyPlugin extends Plugin {
  settings: AnkifySettings;

  async onload() {
    await this.loadSettings();

    // 在编辑器菜单中添加一个命令
    this.addCommand({
      id: "generate-anki-cards",
      name: "生成Anki卡片",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        this.processContent(editor, view);
      },
    });

    // 添加设置面板
    this.addSettingTab(new AnkifySettingTab(this.app, this));

    // 在编辑器工具栏添加一个按钮
    this.addRibbonIcon("dice", "Ankify选中内容", (evt: MouseEvent) => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view) {
        this.processContent(view.editor, view);
      } else {
        new Notice("请先打开一个Markdown文件");
      }
    });
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // 调用Anki Connect API
  async invokeAnkiConnect(action: string, params = {}) {
    const requestBody = {
      action,
      version: 6,
      params,
    };

    console.log("发送Anki Connect请求:", {
      url: this.settings.ankiConnectUrl,
      action,
      params,
    });

    const response = await fetch(this.settings.ankiConnectUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`Anki Connect请求失败: ${response.statusText}`);
    }

    const data = await response.json();
    console.log("Anki Connect响应:", data);

    if (data.error) {
      throw new Error(`Anki Connect错误: ${data.error}`);
    }

    return data.result;
  }

  // 获取可用的牌组列表
  async getDeckNames() {
    try {
      return await this.invokeAnkiConnect("deckNames");
    } catch (error) {
      console.error("获取牌组列表失败:", error);
      new Notice(
        "获取Anki牌组列表失败，请确保Anki已启动且安装了Anki Connect插件"
      );
      return [];
    }
  }

  // 获取可用的笔记类型列表
  async getNoteTypes() {
    try {
      return await this.invokeAnkiConnect("modelNames");
    } catch (error) {
      console.error("获取笔记类型列表失败:", error);
      return [];
    }
  }

  // 解析生成的Anki卡片文本
  parseAnkiCards(text: string): AnkiCard[] {
    const cards: AnkiCard[] = [];

    // 检查是否是多行格式（每个字段一行，卡片间有空行）
    const isMultiLineFormat = /Q:.*\nA:.*(\nannotation:.*)?(\ntags:.*)?/i.test(
      text
    );

    if (isMultiLineFormat) {
      console.log("检测到多行格式数据");

      // 通过空行或多个换行符分割不同的卡片
      const cardBlocks = text.split(/\n\s*\n+/).filter((block) => block.trim());

      for (const block of cardBlocks) {
        const lines = block
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line);
        const card: AnkiCard = { question: "", answer: "" };

        for (const line of lines) {
          if (line.startsWith("Q:")) {
            card.question = line.substring(2).trim();
          } else if (line.startsWith("A:")) {
            card.answer = line.substring(2).trim();
          } else if (line.startsWith("annotation:")) {
            card.annotation = line.substring(11).trim();
          } else if (line.startsWith("tags:")) {
            const tagsText = line.substring(5).trim();
            // 处理标签
            if (tagsText.includes("#")) {
              // 带#格式：#tag1 #tag2
              card.tags = tagsText
                .split("#")
                .map((tag) => tag.trim())
                .filter((tag) => tag.length > 0);
            } else {
              // 不带#格式
              card.tags = tagsText
                .split(/[\s,]+/)
                .map((tag) => tag.trim())
                .filter((tag) => tag.length > 0);
            }
          }
        }

        // 确保卡片至少有问题和答案
        if (card.question && card.answer) {
          cards.push(card);
        }
      }
    } else {
      // 检查是否是表格格式
      const lines = text.split("\n").filter((line) => line.trim());

      // 如果没有内容，直接返回空数组
      if (lines.length === 0) {
        return cards;
      }

      // 检查表格格式（第一行包含Q、A、annotation、tags等标题）
      const headerLine = lines[0].trim();
      const isTableFormat = /^Q[\t\s]+A[\t\s]+annotation[\t\s]+tags$/i.test(
        headerLine
      );

      if (isTableFormat) {
        console.log("检测到表格格式数据");
        // 跳过标题行，解析表格内容
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          // 尝试按制表符分割
          let parts: string[];
          if (line.includes("\t")) {
            parts = line.split("\t");
          } else {
            // 使用正则表达式匹配连续空格分隔的部分
            parts = line.split(/\s{2,}/);
          }

          if (parts.length >= 2) {
            const card: AnkiCard = {
              question: parts[0].trim(),
              answer: parts[1].trim(),
            };

            if (parts.length >= 3 && parts[2].trim()) {
              card.annotation = parts[2].trim();
            }

            if (parts.length >= 4 && parts[3].trim()) {
              // 处理标签 - 支持带#和不带#的格式
              const tagsText = parts[3].trim();
              if (tagsText) {
                if (tagsText.includes("#")) {
                  // 带#格式：#tag1 #tag2
                  const tagParts = tagsText.split("#");
                  card.tags = tagParts
                    .map((tag) => tag.trim())
                    .filter((tag) => tag.length > 0);
                } else {
                  // 不带#格式，假设用空格或逗号分隔
                  card.tags = tagsText
                    .split(/[\s,]+/)
                    .map((tag) => tag.trim())
                    .filter((tag) => tag.length > 0);
                }
              }
            }

            cards.push(card);
          }
        }
      } else {
        // 原有的解析逻辑
        for (const line of lines) {
          // 基本格式：Q: 问题 A: 答案
          const qaMatch = line.match(
            /Q:\s*(.*?)\s*A:\s*(.*?)(?:\s*annotation:|$|\s*tags:)/i
          );
          if (qaMatch) {
            const card: AnkiCard = {
              question: qaMatch[1]?.trim() || "",
              answer: qaMatch[2]?.trim() || "",
            };

            // 查找注释
            const annotationMatch = line.match(
              /annotation:\s*(.*?)(?:\s*tags:|$)/i
            );
            if (annotationMatch) {
              card.annotation = annotationMatch[1]?.trim();
            }

            // 查找标签
            const tagsMatch = line.match(/tags:\s*(.*?)$/i);
            if (tagsMatch && tagsMatch[1]) {
              // 解析标签，格式为 #tag1 #tag2
              card.tags = tagsMatch[1]
                .split("#")
                .map((tag) => tag.trim())
                .filter((tag) => tag.length > 0);
            }

            cards.push(card);
          } else {
            // 尝试匹配问题:::答案格式
            const splitLine = line.split(":::");
            if (splitLine.length >= 2) {
              cards.push({
                question: splitLine[0].trim(),
                answer: splitLine[1].trim(),
              });
            }
          }
        }
      }
    }

    console.log(`解析出 ${cards.length} 张卡片`);
    return cards;
  }

  // 添加卡片到Anki
  async addNotesToAnki(cards: AnkiCard[], deckName: string, noteType: string) {
    // 验证输入参数
    if (!deckName || !noteType) {
      throw new Error("牌组名称和笔记类型不能为空");
    }

    console.log("准备添加卡片到Anki:", {
      deckName,
      noteType,
      cardCount: cards.length,
      firstCard: cards[0],
    });

    const notes = await Promise.all(
      cards.map(async (card, index) => {
        // 验证卡片内容
        if (!card.question || !card.answer) {
          throw new Error(
            `卡片内容不完整：\n问题：${card.question}\n答案：${card.answer}`
          );
        }

        // 根据笔记类型构建字段映射
        let fields: Record<string, string> = {};

        // 获取笔记类型的字段名称
        const modelFieldNames = await this.invokeAnkiConnect(
          "modelFieldNames",
          { modelName: noteType }
        );
        console.log(`笔记类型 ${noteType} 的字段名称:`, modelFieldNames);

        // 根据字段名称进行映射
        if (
          modelFieldNames.includes("Front") &&
          modelFieldNames.includes("Back")
        ) {
          fields = {
            Front: card.question,
            Back:
              card.answer +
              (card.annotation
                ? `\n<hr>\n<span style="color: rgb(143, 53, 8);">${card.annotation}</span>`
                : ""),
          };
        } else if (
          modelFieldNames.includes("正面") &&
          modelFieldNames.includes("背面")
        ) {
          fields = {
            正面: card.question,
            背面:
              card.answer +
              (card.annotation
                ? `\n<hr>\n<span style="color: rgb(143, 53, 8);">${card.annotation}</span>`
                : ""),
          };
        } else if (
          modelFieldNames.includes("Text") &&
          modelFieldNames.includes("Extra")
        ) {
          fields = {
            Text: card.question,
            Extra:
              card.answer +
              (card.annotation
                ? `\n<hr>\n<span style="color: rgb(143, 53, 8);">${card.annotation}</span>`
                : ""),
          };
        } else {
          // 如果无法确定字段名称，尝试使用第一个字段作为问题，第二个字段作为答案
          if (modelFieldNames.length >= 2) {
            fields = {
              [modelFieldNames[0]]: card.question,
              [modelFieldNames[1]]:
                card.answer +
                (card.annotation
                  ? `\n<hr>\n<span style="color: rgb(143, 53, 8);">${card.annotation}</span>`
                  : ""),
            };
          } else {
            throw new Error(`无法确定笔记类型 ${noteType} 的字段映射`);
          }
        }

        // 验证字段映射
        for (const [key, value] of Object.entries(fields)) {
          if (!value || value.trim() === "") {
            throw new Error(`字段 "${key}" 不能为空`);
          }
        }

        const note = {
          deckName,
          modelName: noteType,
          fields,
          tags: card.tags || [],
          options: {
            allowDuplicate: false,
          },
        };

        console.log(`第 ${index + 1} 张卡片的完整笔记对象:`, note);
        return note;
      })
    );

    // 批量添加笔记
    try {
      console.log("正在添加笔记到Anki:", {
        deckName,
        noteType,
        noteCount: notes.length,
        firstNote: notes[0],
      });

      const result = await this.invokeAnkiConnect("addNotes", { notes });

      // 检查结果
      if (!result || !Array.isArray(result)) {
        throw new Error("Anki Connect返回了无效的结果");
      }

      // 检查是否有失败的笔记
      const failedNotes = result.filter((id) => id === null);
      if (failedNotes.length > 0) {
        console.warn(`有 ${failedNotes.length} 张卡片添加失败`);
      }

      return result;
    } catch (error) {
      console.error("添加笔记失败:", error);
      throw new Error(`添加笔记失败: ${error.message}`);
    }
  }

  async processContent(editor: Editor, view: MarkdownView) {
    // 修改为处理选中的文本，而不是整篇文章
    const selectedText = editor.getSelection();

    if (!selectedText) {
      new Notice("请先选择要处理的文本内容");
      return;
    }

    // 检查选择的模型对应的API密钥是否已设置
    let apiKey = "";
    const model = this.settings.apiModel;
    
    if (model === "deepseek") {
      apiKey = this.settings.deepseekApiKey;
    } else if (model === "openai") {
      apiKey = this.settings.openaiApiKey;
    } else if (model === "claude") {
      apiKey = this.settings.claudeApiKey;
    }
    
    if (!apiKey) {
      new Notice(`请先设置${model === "deepseek" ? "DeepSeek" : model === "openai" ? "OpenAI" : "Claude"} API密钥`);
      return;
    }

    new Notice("正在生成Anki卡片...");

    try {
      const result = await this.callModelAPI(selectedText);

      if (this.settings.insertToDocument) {
        // 在文档末尾插入结果
        this.appendResultToDocument(editor, result);
      } else {
        // 解析卡片并展示选择界面
        const cards = this.parseAnkiCards(result);
        new SelectableCardsModal(this.app, cards, result, this, editor).open();
      }
    } catch (error) {
      console.error("API调用失败:", error);
      new Notice("生成Anki卡片失败：" + error.message);
    }
  }

  // 新增方法：将结果追加到文档末尾
  appendResultToDocument(editor: Editor, result: string) {
    const docContent = editor.getValue();
    const newContent = docContent + "\n\n## Anki卡片\n\n" + result;
    editor.setValue(newContent);
    new Notice("Anki卡片已添加到文档末尾");
  }

  async callModelAPI(content: string): Promise<string> {
    const prompt = this.settings.customPrompt + content;
    const startTime = Date.now();
    const model = this.settings.apiModel;
    let apiUrl = "";
    let headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    let requestBody: any = {};

    // 根据选择的模型设置API请求参数
    if (model === "deepseek") {
      apiUrl = "https://api.deepseek.com/v1/chat/completions";
      headers["Authorization"] = `Bearer ${this.settings.deepseekApiKey}`;
      requestBody = {
        model: "deepseek-chat",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.7,
      };
    } else if (model === "openai") {
      apiUrl = "https://api.openai.com/v1/chat/completions";
      headers["Authorization"] = `Bearer ${this.settings.openaiApiKey}`;
      requestBody = {
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.7,
      };
    } else if (model === "claude") {
      apiUrl = "https://api.anthropic.com/v1/messages";
      headers["x-api-key"] = this.settings.claudeApiKey;
      headers["anthropic-version"] = "2023-06-01";
      requestBody = {
        model: "claude-3-haiku-20240307",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: 1000,
        temperature: 0.7,
      };
    } else {
      throw new Error("不支持的模型类型");
    }

    // 发送API请求
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || "请求失败");
    }

    const data = await response.json();
    const endTime = Date.now();
    console.log(`${model.toUpperCase()} API响应时间: ${endTime - startTime}ms`);
    
    // 根据不同API响应格式获取结果
    let result = "";
    if (model === "deepseek" || model === "openai") {
      result = data.choices[0]?.message?.content || "无法生成卡片内容";
    } else if (model === "claude") {
      result = data.content[0]?.text || "无法生成卡片内容";
    }
    
    return result;
  }
}

// 卡片选择模态框
class SelectableCardsModal extends Modal {
  cards: AnkiCard[];
  rawResult: string;
  plugin: AnkifyPlugin;
  editor: Editor;
  selectedCards: boolean[];
  deckName: string;
  noteType: string;
  deckSelect: HTMLSelectElement;
  noteTypeSelect: HTMLSelectElement;
  loadingEl: HTMLElement;

  constructor(
    app: App,
    cards: AnkiCard[],
    rawResult: string,
    plugin: AnkifyPlugin,
    editor: Editor
  ) {
    super(app);
    this.cards = cards;
    this.rawResult = rawResult;
    this.plugin = plugin;
    this.editor = editor;
    this.selectedCards = cards.map(() => true); // 默认全选
    this.deckName = plugin.settings.defaultDeck;
    this.noteType = plugin.settings.defaultNoteType;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    // 设置模态框为常驻
    this.modalEl.style.position = "fixed";
    this.modalEl.style.top = "50%";
    this.modalEl.style.left = "50%";
    this.modalEl.style.transform = "translate(-50%, -50%)";
    this.modalEl.style.width = "80%";
    this.modalEl.style.maxWidth = "800px";
    this.modalEl.style.maxHeight = "80vh";
    this.modalEl.style.overflow = "auto";

    // 添加加载提示
    this.loadingEl = contentEl.createDiv({ cls: "ankify-loading" });
    this.loadingEl.createEl("div", { cls: "ankify-loading-spinner" });
    this.loadingEl.createEl("div", { text: "正在加载..." });

    // 异步加载内容
    this.loadContent().then(() => {
      this.loadingEl.remove();
    });
  }

  async loadContent() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Anki卡片选择" });

    if (this.cards.length === 0) {
      contentEl.createEl("p", {
        text: "未能解析出有效的Anki卡片，请检查生成结果格式。",
      });

      // 显示原始结果和编辑选项
      const rawResultEl = contentEl.createDiv({ cls: "ankify-raw-result" });
      const textAreaEl = rawResultEl.createEl("textarea", {
        cls: "ankify-editable-result",
        text: this.rawResult,
      });
      textAreaEl.style.width = "100%";
      textAreaEl.style.height = "100px";

      const buttonContainer = contentEl.createDiv({
        cls: "ankify-button-container",
      });
      const copyButton = buttonContainer.createEl("button", {
        text: "复制内容",
      });
      copyButton.addEventListener("click", () => {
        navigator.clipboard.writeText(textAreaEl.value);
        new Notice("已复制到剪贴板");
      });

      const insertButton = buttonContainer.createEl("button", {
        text: "插入到文档",
      });
      insertButton.addEventListener("click", () => {
        const docContent = this.editor.getValue();
        const newContent =
          docContent + "\n\n## Anki卡片\n\n" + textAreaEl.value;
        this.editor.setValue(newContent);
        new Notice("内容已添加到文档末尾");
        this.close();
      });

      return;
    }

    // Anki设置区域
    const ankiSettingsEl = contentEl.createDiv({ cls: "ankify-anki-settings" });

    // 获取可用牌组
    let decks: string[] = [];
    try {
      decks = await this.plugin.getDeckNames();
    } catch (error) {
      // 如果获取失败，添加一个提示
      ankiSettingsEl.createEl("p", {
        cls: "ankify-error",
        text: "无法连接到Anki。请确保Anki已经启动，且已安装Anki Connect插件。",
      });
    }

    // 牌组选择器
    const deckContainer = ankiSettingsEl.createDiv({
      cls: "ankify-setting-item",
    });
    deckContainer.createEl("label", { text: "选择牌组：" });
    this.deckSelect = deckContainer.createEl("select");

    if (decks.length > 0) {
      // 添加可用牌组选项
      decks.forEach((deck) => {
        const option = this.deckSelect.createEl("option", {
          value: deck,
          text: deck,
        });
        if (deck === this.plugin.settings.defaultDeck) {
          option.selected = true;
          this.deckName = deck;
        }
      });
    } else {
      // 如果没有获取到牌组，添加默认选项
      this.deckSelect.createEl("option", {
        value: this.deckName,
        text: this.deckName,
      });
    }

    this.deckSelect.addEventListener("change", () => {
      this.deckName = this.deckSelect.value;
    });

    // 笔记类型选择器
    const noteTypes = await this.plugin.getNoteTypes();
    const noteTypeContainer = ankiSettingsEl.createDiv({
      cls: "ankify-setting-item",
    });
    noteTypeContainer.createEl("label", { text: "笔记类型：" });
    this.noteTypeSelect = noteTypeContainer.createEl("select");

    if (noteTypes.length > 0) {
      noteTypes.forEach((type: string) => {
        const option = this.noteTypeSelect.createEl("option", {
          value: type,
          text: type,
        });
        if (type === this.plugin.settings.defaultNoteType) {
          option.selected = true;
          this.noteType = type;
        }
      });
    } else {
      // 默认笔记类型选项
      const basicTypes = [
        "Basic",
        "Basic (and reversed card)",
        "Cloze",
        "Basic (optional reversed card)",
      ];
      basicTypes.forEach((type) => {
        const option = this.noteTypeSelect.createEl("option", {
          value: type,
          text: type,
        });
        if (type === this.plugin.settings.defaultNoteType) {
          option.selected = true;
          this.noteType = type;
        }
      });
    }

    this.noteTypeSelect.addEventListener("change", () => {
      this.noteType = this.noteTypeSelect.value;
    });

    // 卡片选择区域
    const cardsContainer = contentEl.createDiv({
      cls: "ankify-cards-container",
    });

    // 添加全选/全不选按钮
    const selectAllContainer = cardsContainer.createDiv({
      cls: "ankify-select-all",
    });
    const selectAllCheckbox = selectAllContainer.createEl("input", {
      type: "checkbox",
    });
    selectAllCheckbox.checked = true;
    selectAllContainer.createEl("label", { text: "全选/全不选" });

    selectAllCheckbox.addEventListener("change", () => {
      this.selectedCards = this.selectedCards.map(
        () => selectAllCheckbox.checked
      );
      this.updateCardSelectionDisplay();
    });

    // 卡片列表
    const cardsListEl = cardsContainer.createDiv({ cls: "ankify-cards-list" });

    this.cards.forEach((card, index) => {
      const cardEl = cardsListEl.createDiv({ cls: "ankify-card" });

      // 添加选择框
      const checkboxContainer = cardEl.createDiv({
        cls: "ankify-card-checkbox",
      });
      const checkbox = checkboxContainer.createEl("input", {
        type: "checkbox",
        attr: { id: `card-checkbox-${index}` },
      });
      checkbox.checked = this.selectedCards[index];

      checkbox.addEventListener("change", () => {
        this.selectedCards[index] = checkbox.checked;
      });

      // 卡片内容展示
      const cardContent = cardEl.createDiv({ cls: "ankify-card-content" });

      // 问题编辑
      const questionEl = cardContent.createDiv({ cls: "ankify-card-question" });
      questionEl.createEl("strong", { text: "问题: " });
      const questionInput = questionEl.createEl("input", {
        cls: "ankify-card-input",
        type: "text",
        value: card.question,
      });
      questionInput.addEventListener("change", () => {
        this.cards[index].question = questionInput.value;
      });

      // 答案编辑
      const answerEl = cardContent.createDiv({ cls: "ankify-card-answer" });
      answerEl.createEl("strong", { text: "答案: " });
      const answerInput = answerEl.createEl("input", {
        cls: "ankify-card-input",
        type: "text",
        value: card.answer,
      });
      answerInput.addEventListener("change", () => {
        this.cards[index].answer = answerInput.value;
      });

      // 注释编辑
      if (card.annotation) {
        const annotationEl = cardContent.createDiv({
          cls: "ankify-card-annotation",
        });
        annotationEl.createEl("strong", { text: "注释: " });
        const annotationInput = annotationEl.createEl("input", {
          cls: "ankify-card-input",
          type: "text",
          value: card.annotation,
        });
        annotationInput.addEventListener("change", () => {
          this.cards[index].annotation = annotationInput.value;
        });
      }

      // 标签编辑
      if (card.tags && card.tags.length > 0) {
        const tagsEl = cardContent.createDiv({ cls: "ankify-card-tags" });
        tagsEl.createEl("strong", { text: "标签: " });
        const tagsInput = tagsEl.createEl("input", {
          cls: "ankify-card-input",
          type: "text",
          value: card.tags.join(" "),
        });
        tagsInput.addEventListener("change", () => {
          this.cards[index].tags = tagsInput.value
            .split(/\s+/)
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0);
        });
      }
    });

    // 按钮区域
    const buttonContainer = contentEl.createDiv({
      cls: "ankify-button-container",
    });

    // 添加到Anki按钮
    const addToAnkiButton = buttonContainer.createEl("button", {
      cls: "ankify-primary-button",
      text: "添加到Anki",
    });

    addToAnkiButton.addEventListener("click", async () => {
      // 获取选中的卡片
      const selectedCardsList = this.cards.filter(
        (_, index) => this.selectedCards[index]
      );

      if (selectedCardsList.length === 0) {
        new Notice("请至少选择一张卡片");
        return;
      }

      try {
        // 显示加载提示
        const loadingNotice = new Notice("正在添加卡片到Anki...", 0);
        const result = await this.plugin.addNotesToAnki(
          selectedCardsList,
          this.deckName,
          this.noteType
        );

        // 记住用户的选择作为默认值
        this.plugin.settings.defaultDeck = this.deckName;
        this.plugin.settings.defaultNoteType = this.noteType;
        await this.plugin.saveSettings();

        // 显示添加成功的卡片数量
        const successCount = result.filter((id: any) => id !== null).length;
        loadingNotice.hide();
        new Notice(
          `成功添加 ${successCount}/${selectedCardsList.length} 张卡片到Anki`
        );
        this.close();
      } catch (error) {
        new Notice(`添加卡片失败: ${error.message}`);
      }
    });

    // 复制内容按钮
    const copyButton = buttonContainer.createEl("button", {
      text: "复制全部内容",
    });
    copyButton.addEventListener("click", () => {
      navigator.clipboard.writeText(this.rawResult);
      new Notice("已复制原始内容到剪贴板");
    });

    // 插入到文档按钮
    const insertButton = buttonContainer.createEl("button", {
      text: "插入到文档",
    });
    insertButton.addEventListener("click", () => {
      const docContent = this.editor.getValue();
      const newContent = docContent + "\n\n## Anki卡片\n\n" + this.rawResult;
      this.editor.setValue(newContent);
      new Notice("内容已添加到文档末尾");
      this.close();
    });
  }

  // 更新卡片选择框状态
  updateCardSelectionDisplay() {
    this.selectedCards.forEach((isSelected, index) => {
      const checkbox = document.getElementById(
        `card-checkbox-${index}`
      ) as HTMLInputElement;
      if (checkbox) {
        checkbox.checked = isSelected;
      }
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

// 设置面板
class AnkifySettingTab extends PluginSettingTab {
  plugin: AnkifyPlugin;

  constructor(app: App, plugin: AnkifyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Ankify 插件设置" });

    // API模型选择
    new Setting(containerEl)
      .setName("AI模型选择")
      .setDesc("选择用于生成Anki卡片的AI模型")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("deepseek", "DeepSeek")
          .addOption("openai", "OpenAI")
          .addOption("claude", "Claude")
          .setValue(this.plugin.settings.apiModel)
          .onChange(async (value) => {
            this.plugin.settings.apiModel = value;
            await this.plugin.saveSettings();
            // 刷新设置页面以显示相应的API密钥设置
            this.display();
          });
      });

    // 根据选择的模型显示相应的API密钥设置
    if (this.plugin.settings.apiModel === "deepseek") {
      new Setting(containerEl)
        .setName("DeepSeek API 密钥")
        .setDesc("输入您的DeepSeek API密钥")
        .addText((text) =>
          text
            .setPlaceholder("sk-...")
            .setValue(this.plugin.settings.deepseekApiKey)
            .onChange(async (value) => {
              this.plugin.settings.deepseekApiKey = value;
              await this.plugin.saveSettings();
            })
        );
    } else if (this.plugin.settings.apiModel === "openai") {
      new Setting(containerEl)
        .setName("OpenAI API 密钥")
        .setDesc("输入您的OpenAI API密钥")
        .addText((text) =>
          text
            .setPlaceholder("sk-...")
            .setValue(this.plugin.settings.openaiApiKey)
            .onChange(async (value) => {
              this.plugin.settings.openaiApiKey = value;
              await this.plugin.saveSettings();
            })
        );
    } else if (this.plugin.settings.apiModel === "claude") {
      new Setting(containerEl)
        .setName("Claude API 密钥")
        .setDesc("输入您的Claude API密钥")
        .addText((text) =>
          text
            .setPlaceholder("sk-...")
            .setValue(this.plugin.settings.claudeApiKey)
            .onChange(async (value) => {
              this.plugin.settings.claudeApiKey = value;
              await this.plugin.saveSettings();
            })
        );
    }

    new Setting(containerEl)
      .setName("自定义Prompt")
      .setDesc("设置生成Anki卡片的提示词")
      .addTextArea(
        (text) =>
          (text
            .setPlaceholder(
              '请基于以下内容创建Anki卡片，格式为"问题:::答案"...'
            )
            .setValue(this.plugin.settings.customPrompt)
            .onChange(async (value) => {
              this.plugin.settings.customPrompt = value;
              await this.plugin.saveSettings();
            }).inputEl.style.minHeight = "80px")
      );

    // 新增设置：是否直接插入文档
    new Setting(containerEl)
      .setName("直接插入文档")
      .setDesc("启用后，生成的Anki卡片将直接插入到文档末尾，而不是显示在弹窗中")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.insertToDocument)
          .onChange(async (value) => {
            this.plugin.settings.insertToDocument = value;
            await this.plugin.saveSettings();
          })
      );

    // Anki Connect 相关设置
    containerEl.createEl("h3", { text: "Anki Connect 设置" });

    new Setting(containerEl)
      .setName("Anki Connect URL")
      .setDesc("Anki Connect API的地址，默认为 http://127.0.0.1:8765")
      .addText((text) =>
        text
          .setPlaceholder("http://127.0.0.1:8765")
          .setValue(this.plugin.settings.ankiConnectUrl)
          .onChange(async (value) => {
            this.plugin.settings.ankiConnectUrl = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("默认牌组")
      .setDesc("添加卡片时的默认牌组名称")
      .addText((text) =>
        text
          .setPlaceholder("Default")
          .setValue(this.plugin.settings.defaultDeck)
          .onChange(async (value) => {
            this.plugin.settings.defaultDeck = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("默认笔记类型")
      .setDesc("添加卡片时的默认笔记类型")
      .addText((text) =>
        text
          .setPlaceholder("Basic")
          .setValue(this.plugin.settings.defaultNoteType)
          .onChange(async (value) => {
            this.plugin.settings.defaultNoteType = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
