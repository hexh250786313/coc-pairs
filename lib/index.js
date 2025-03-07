"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wait = exports.byteSlice = exports.activate = void 0;
const coc_nvim_1 = require("coc.nvim");
const pairs = new Map();
pairs.set('{', '}');
pairs.set('[', ']');
pairs.set('(', ')');
pairs.set('<', '>');
pairs.set('"', '"');
pairs.set("'", "'");
pairs.set('`', '`');
const insertMaps = new Map();
// let currentInsert: InsertState | undefined
function removeLast(bufnr) {
    let insert = insertMaps.get(bufnr);
    if (!insert)
        return;
    insert.pairs.pop();
    if (insert.pairs.length == 0) {
        insertMaps.delete(bufnr);
    }
}
function shouldRemove(insert, index) {
    if (!insert)
        return false;
    let { pairs } = insert;
    let last = pairs[pairs.length - 1];
    if (!last)
        return false;
    return last.position.character + last.inserted.length === index;
}
async function activate(context) {
    let { subscriptions } = context;
    const config = coc_nvim_1.workspace.getConfiguration('pairs');
    const disableLanguages = config.get('disableLanguages');
    const characters = config.get('enableCharacters', []);
    const alwaysPairCharacters = config.get('alwaysPairCharacters', []);
    let enableBackspace = config.get('enableBackspace', true);
    subscriptions.push(coc_nvim_1.events.on('BufUnload', bufnr => {
        insertMaps.delete(bufnr);
    }));
    subscriptions.push(coc_nvim_1.events.on('InsertLeave', bufnr => {
        insertMaps.delete(bufnr);
    }));
    subscriptions.push(coc_nvim_1.events.on('CursorMovedI', (bufnr, cursor) => {
        let currentInsert = insertMaps.get(bufnr);
        if (!currentInsert)
            return;
        if (currentInsert.bufnr != bufnr || currentInsert.lnum !== cursor[0]) {
            insertMaps.delete(bufnr);
            return;
        }
        let { pairs } = currentInsert;
        let doc = coc_nvim_1.workspace.getDocument(bufnr);
        if (!doc || !doc.attached)
            return;
        let line = doc.getline(cursor[0] - 1);
        let index = characterIndex(line, cursor[1] - 1);
        let last = pairs[pairs.length - 1];
        // move before insert position
        if (!last || last.position.character > index) {
            insertMaps.delete(bufnr);
        }
    }));
    const { nvim, isVim } = coc_nvim_1.workspace;
    const localParis = new Map();
    // remove paired characters when possible
    async function onBackspace() {
        let { nvim } = coc_nvim_1.workspace;
        let res = await nvim.eval('[getline("."),col("."),synIDattr(synID(line("."), col(".") - 2, 1), "name"),bufnr("%")]');
        if (res) {
            let [line, col, synname, bufnr] = res;
            if (col > 1 && !/string/i.test(synname)) {
                let buf = Buffer.from(line, 'utf8');
                if (col - 1 < buf.length) {
                    let pre = buf.slice(col - 2, col - 1).toString('utf8');
                    let next = buf.slice(col - 1, col).toString('utf8');
                    let local = localParis.get(bufnr);
                    if (local && local.find(arr => arr[0] == pre && arr[1] == next)) {
                        await nvim.eval(`feedkeys("\\<C-G>U\\<right>\\<bs>\\<bs>", 'in')`);
                        if (isVim)
                            nvim.command('redraw', true);
                        return;
                    }
                    let idx = characterIndex(line, col - 1);
                    let currentInsert = insertMaps.get(bufnr);
                    if (shouldRemove(currentInsert, idx) && characters.includes(pre) && pairs.get(pre) == next) {
                        removeLast(bufnr);
                        await nvim.eval(`feedkeys("\\<C-G>U\\<right>\\<bs>\\<bs>", 'in')`);
                        if (isVim)
                            nvim.command('redraw', true);
                        return;
                    }
                }
            }
        }
        await nvim.eval(`feedkeys("\\<bs>", 'in')`);
        if (isVim)
            nvim.command('redraw', true);
        return '';
    }
    async function insertPair(character, pair) {
        let samePair = character == pair;
        let arr = await nvim.eval(`[bufnr("%"),get(b:,"coc_pairs_disabled",[]),coc#util#cursor(),&filetype,getline("."),mode(),get(get(g:,'context_filetype#filetypes',{}),&filetype,v:null)]`);
        let filetype = arr[3];
        if (disableLanguages.indexOf(filetype) !== -1)
            return character;
        let bufnr = arr[0];
        let line = arr[4];
        let mode = arr[5];
        if (mode.startsWith('R'))
            return character;
        let chars = arr[1];
        let context = arr[6];
        if (chars && chars.length && chars.indexOf(character) !== -1)
            return character;
        let pos = { line: arr[2][0], character: arr[2][1] };
        let currentInsert = insertMaps.get(bufnr);
        if (currentInsert && currentInsert.lnum != pos.line + 1) {
            currentInsert = undefined;
        }
        let pre = line.slice(0, pos.character);
        let rest = line.slice(pos.character);
        let previous = pre.length ? pre[pre.length - 1] : '';
        if (alwaysPairCharacters.indexOf(character) == -1 && rest && isWord(rest[0], bufnr))
            return character;
        if (character == '<' && (previous == ' ' || previous == '<')) {
            return character;
        }
        if (samePair && rest[0] == character && rest[1] != character) {
            // move position
            await nvim.eval(`feedkeys("\\<C-G>U\\<Right>", 'in')`);
            return '';
        }
        if (samePair && pre && (isWord(previous, bufnr) || previous == character))
            return character;
        // Only pair single quotes if previous character is not word.
        if (character === "'" && pre.match(/.*\w$/)) {
            return character;
        }
        if (context) {
            try {
                let res = await nvim.call('context_filetype#get');
                if (res && res.filetype) {
                    filetype = res.filetype;
                }
            }
            catch (e) {
                // ignore error
            }
        }
        // Rust: don't pair single quotes that are part of lifetime annotations such as `Foo::<'a, 'b>` or `bar: &'a str`
        if (filetype === 'rust' && character === "'" &&
            (pre.endsWith('<') || rest.startsWith('>') || pre.endsWith('&'))) {
            return character;
        }
        if ((filetype === 'vim' || filetype === 'help') && character === '"' && pos.character === 0) {
            return character;
        }
        if (samePair && pre.length >= 2 && previous == character && pre[pre.length - 2] == character) {
            if (pre[pre.length - 3] == character) {
                if (character == '"') {
                    nvim.command(`call feedkeys('"""'."${'\\<C-G>U\\<Left>'.repeat(3)}", 'in')`, true);
                }
                else {
                    nvim.command(`call feedkeys("${character.repeat(3)}${'\\<C-G>U\\<Left>'.repeat(3)}", 'in')`, true);
                }
                return;
            }
            return character;
        }
        if (character == '"') {
            nvim.command(`call feedkeys('""'."\\<C-G>U\\<Left>", 'in')`, true);
        }
        else {
            nvim.command(`call feedkeys("${character}${pair}${'\\<C-G>U\\<Left>'.repeat(pair.length)}", 'in')`, true);
        }
        if (!currentInsert)
            currentInsert = { bufnr, lnum: pos.line + 1, pairs: [] };
        currentInsert.pairs.push({ inserted: character, paired: pair, position: pos });
        insertMaps.set(bufnr, currentInsert);
        return '';
    }
    async function closePair(character) {
        // should not move right when cursor move out
        let [bufnr, cursor, filetype, line] = await nvim.eval('[bufnr("%"),coc#util#cursor(),&filetype,getline(".")]');
        let rest = line.slice(cursor[1]);
        let currentInsert = insertMaps.get(bufnr);
        if (!currentInsert || rest[0] !== character || disableLanguages.includes(filetype))
            return character;
        let item = currentInsert.pairs.find(o => o.paired === character);
        if (!item)
            return character;
        let prev = item.inserted;
        if (prev !== character) {
            let n = 0;
            for (let i = 0; i < line.length; i++) {
                if (line[i] === prev) {
                    n++;
                }
                else if (line[i] === character) {
                    n--;
                }
            }
            if (n > 0)
                return character;
        }
        nvim.command(`call feedkeys("\\<C-G>U\\<Right>", 'in')`, true);
        return '';
    }
    nvim.pauseNotification();
    for (let character of characters) {
        if (pairs.has(character)) {
            subscriptions.push(coc_nvim_1.workspace.registerExprKeymap('i', character, insertPair.bind(null, character, pairs.get(character)), false));
        }
        let matched = pairs.get(character);
        if (matched != character) {
            subscriptions.push(coc_nvim_1.workspace.registerExprKeymap('i', matched, closePair.bind(null, matched), false));
        }
    }
    if (enableBackspace) {
        subscriptions.push(coc_nvim_1.workspace.registerExprKeymap('i', '<bs>', onBackspace, false, false));
    }
    nvim.resumeNotification(false, true);
    async function createBufferKeymap(doc) {
        if (!doc)
            return;
        let pairs = doc.getVar('pairs', null);
        if (!pairs || !pairs.length)
            return;
        localParis.set(doc.bufnr, pairs);
        nvim.pauseNotification();
        for (let p of pairs) {
            if (Array.isArray(p) && p.length == 2) {
                let [character, matched] = p;
                subscriptions.push(coc_nvim_1.workspace.registerExprKeymap('i', character, insertPair.bind(null, character, matched), true));
                if (matched != character) {
                    subscriptions.push(coc_nvim_1.workspace.registerExprKeymap('i', matched, closePair.bind(null, matched), true));
                }
            }
        }
        nvim.resumeNotification(false, true);
    }
    void createBufferKeymap(coc_nvim_1.workspace.getDocument(coc_nvim_1.workspace.bufnr));
    coc_nvim_1.workspace.onDidOpenTextDocument(async (e) => {
        await createBufferKeymap(coc_nvim_1.workspace.getDocument(e.uri));
    });
}
exports.activate = activate;
function byteSlice(content, start, end) {
    let buf = Buffer.from(content, 'utf8');
    return buf.slice(start, end).toString('utf8');
}
exports.byteSlice = byteSlice;
function wait(ms) {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve(undefined);
        }, ms);
    });
}
exports.wait = wait;
function isWord(character, bufnr) {
    let doc = coc_nvim_1.workspace.getDocument(bufnr);
    if (doc && doc.attached)
        return doc.isWord(character);
    let code = character.charCodeAt(0);
    if (code > 128)
        return false;
    if (code == 95)
        return true;
    if (code >= 48 && code <= 57)
        return true;
    if (code >= 65 && code <= 90)
        return true;
    if (code >= 97 && code <= 122)
        return true;
    return false;
}
const UTF8_2BYTES_START = 0x80;
const UTF8_3BYTES_START = 0x800;
const UTF8_4BYTES_START = 65536;
function characterIndex(content, byteIndex) {
    if (byteIndex == 0)
        return 0;
    let characterIndex = 0;
    let total = 0;
    for (let codePoint of content) {
        let code = codePoint.codePointAt(0);
        if (code >= UTF8_4BYTES_START) {
            characterIndex += 2;
            total += 4;
        }
        else {
            characterIndex += 1;
            total += utf8_code2len(code);
        }
        if (total >= byteIndex)
            break;
    }
    return characterIndex;
}
function utf8_code2len(code) {
    if (code < UTF8_2BYTES_START)
        return 1;
    if (code < UTF8_3BYTES_START)
        return 2;
    if (code < UTF8_4BYTES_START)
        return 3;
    return 4;
}
//# sourceMappingURL=index.js.map