// Independent Markdown renderer. All document state belongs to one invocation.
const escapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const punctuation = /[\p{P}\p{S}]/u;
const asciiEscape = /\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g;
const htmlNames = 'address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem meta nav noframes ol optgroup option p param search section summary table tbody td tfoot th thead title tr track ul';
const inlineState=Symbol('inline');
const blockTags = new Set(htmlNames.split(' '));
const tagPattern = /^(?:<!--(?:-?>|[\s\S]*?-->)|<\?[\s\S]*?\?>|<![A-Za-z]+\s[\s\S]*?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/[A-Za-z][\w-]*\s*>|<[A-Za-z][\w-]*(?:\s+[A-Za-z:_][\w.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>)/;
function escape(s, all = false) {
  return s.replace(all ? /[&<>"']/g : /[<>"']|&(?!(?:#\d{1,7}|#[xX][\da-fA-F]{1,6}|\w+);)/g, c => escapes[c]);
}
function numeric(s) {
  if (!/&#(?:\d{1,7}|[xX][\da-fA-F]{1,6});/.test(s)) return s;
  return s.replace(/&#(\d{1,7}|[xX][\da-fA-F]{1,6});|&(?!(?:#\d{1,7}|#[xX][\da-fA-F]{1,6}|\w+);)/g, (m, n) => {
    if (!n) return '&amp;';
    const v = /^[xX]/.test(n) ? parseInt(n.slice(1),16) : +n;
    return !v || v > 0x10ffff || v >= 0xd800 && v <= 0xdfff ? '\ufffd' : v === 38 ? '&amp;' : String.fromCodePoint(v);
  });
}
const unescape = s => s.replace(asciiEscape, '$1');
const labelKey = s => s.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase().toLowerCase();
function href(s) { try { return encodeURI(s).replace(/%25/g, '%'); } catch { return null; } }
function indent(s, column=0) {
  if(!s.includes('\t'))return s;
  return s.replace(/^[ \t]+/, w => { let out=''; for (const c of w) { const n=c==='\t'?4-column%4:1; out+=' '.repeat(n); column+=n; } return out; });
}
function cells(s, count) {
  const result=[]; let start=0;
  for(let i=0;i<s.length;i++) if(s[i]==='|') { let j=i-1; while(j>=0&&s[j]==='\\')j--; if((i-1-j)%2===0){result.push(s.slice(start,i));start=i+1;} }
  result.push(s.slice(start));
  if(!result[0].trim())result.shift();
  if(result.length&&!result.at(-1).trim())result.pop();
  if(count!==undefined){result.length=Math.min(result.length,count);while(result.length<count)result.push('');}
  return result.map(x=>x.trim().replace(/\\\|/g,'|'));
}
function isHR(s){return /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(s);}
function bullet(s){return /^( {0,3})([*+-]|\d{1,9}[.)])([ \t].*|$)/.exec(s);}
function fence(s){return /^ {0,3}(`{3,}(?![^\n]*`)|~{3,})([^\n]*)$/.exec(s);}
function heading(s){return /^ {0,3}(#{1,6})(?=\s|$)(.*)$/.exec(s);}
function htmlStart(s, interrupt=false){
  if(!/^ {0,3}</.test(s))return null;
  const m=/^ {0,3}<(?:(script|pre|style|textarea)(?=[\s>]|$)|(!--)|(\?)|(!\[CDATA\[)|(![A-Z])|\/?([a-z][\w-]*)(?=[\s/>]|$))/i.exec(s);
  if(!m)return null;
  if(m[1])return {end:new RegExp('</'+m[1]+'>','i')};
  if(m[2])return {end:/-->/}; if(m[3])return {end:/\?>/}; if(m[4])return {end:/\]\]>/}; if(m[5])return {end:/>/};
  if(blockTags.has(m[6]?.toLowerCase()))return {blank:true};
  if(!interrupt&&/^ {0,3}(?:<\/[a-z][\w-]*\s*>|<[a-z][\w-]*(?: +[a-z:_][\w.:-]*(?: *= *(?:"[^"\n]*"|'[^'\n]*'|[^\s"'=<>`]+))?)* *\/?>)[ \t]*$/i.test(s))return {blank:true};
  return null;
}
function tableAt(lines,i){
  if(i+1>=lines.length||!lines[i].trim()||!/^ {0,3}\|? *:?-+:? *(?:\| *:?-+:? *)*\|? *$/.test(lines[i+1])||!/[|:]/.test(lines[i+1]))return null;
  const heads=cells(lines[i]);const sep=lines[i+1].trim().replace(/^\||\|$/g,'').split('|');
  if(heads.length!==sep.length)return null;
  return {heads,align:sep.map(x=>{x=x.trim();return x.endsWith(':')?x.startsWith(':')?'center':'right':x.startsWith(':')?'left':null;})};
}
function lazyParagraph(s){
  let prev;do {prev=s;s=s.replace(/^ {0,3}> ?/,'').replace(/^ {0,3}(?:[*+-]|\d{1,9}[.)])[ \t]+/,'');}while(s!==prev);
  return !!s.trim()&&!/^(?: {4}| {0,3}\t)/.test(s)&&!interrupts([s],0);
}
function interrupts(lines,i,para=true){
  const s=lines[i];if(s===undefined)return true;
  if(!s.trim()&&!(s.length&&i===lines.length-1)||isHR(s)||heading(s)||fence(s)||/^ {0,3}>/.test(s)||htmlStart(s,true))return true;
  const b=bullet(s);if(b&&(!para||(!/^\d/.test(b[2])||/^1[.)]$/.test(b[2]))&&b[3].trim()))return true;
  return !!tableAt(lines,i);
}
function tableStop(s){
  if(/^ *$/.test(s)||isHR(s)||heading(s)||fence(s)||/^ {0,3}>/.test(s)||htmlStart(s,true)||/^(?: {4}| {0,3}\t).+/.test(s))return true;
  return /^ {0,3}(?:[*+-]|1[.)])[ \t]/.test(s);
}
function definition(lines,i){
  if(!/^ {0,3}\[/.test(lines[i]))return null;
  const src=lines.slice(i,i+5).join('\n');
  const m=/^ {0,3}\[((?:\\.|[^\[\]\\\n]|\n(?![ \t]*\n))+)\]: *(?:\n[ \t]*)?(<[^<>\n]*>|[^\s<>]+)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\\n]|\n(?!\n))*'|\((?:\\.|[^()\\])*\)))? *(?=\n|$)/.exec(src);
  if(!m||!m[1].trim())return null;
  if(m[2][0]!=='<'){let depth=0;for(let j=0;j<m[2].length;j++){if(m[2][j]==='\\'){j++;continue;}if(m[2][j]==='(')depth++;if(m[2][j]===')'&&--depth<0)return null;}if(depth)return null;}
  return {n:m[0].split('\n').length,key:labelKey(m[1]),href:unescape(m[2].replace(/^<|>$/g,'')),title:m[3]?unescape(m[3].slice(1,-1)):''};
}
function paragraphTail(nodes){let n=nodes.at(-1);if(!n)return false;if(n.type==='quote')return paragraphTail(n.children);if(n.type==='list')return paragraphTail(n.items.at(-1).children);return n.type==='p'||n.type==='text';}
// Block nodes defer inline work until all reference definitions are available.
function blocks(lines, refs, top=true, forced=null){
  const out=[];let i=0;
  while(i<lines.length){
    const line=lines[i];
    if(!line.trim()){let j=i;while(i<lines.length&&!lines[i].trim())i++;out.push({type:'space',n:i-j});continue;}
    if(/^(?: {4}| {0,3}\t)/.test(line)){
      let j=i, last=i;while(j<lines.length){if(/^(?: {4}| {0,3}\t)/.test(lines[j]))last=j++;else if(!lines[j].trim())j++;else break;}
      let text=lines.slice(i,last+1).map(s=>s.replace(/^(?: {0,3}\t| {1,4})/,'')).join('\n');
      const prev=out.at(-1);if(prev&&(prev.type==='p'||prev.type==='text'))prev.text+='\n'+text+(last+1<lines.length&&lines.slice(last+1).some(s=>s.trim())?'\n':'');else out.push({type:'code',text});i=last+1;continue;
    }
    let m=fence(line);
    if(m){let j=i+1;const close=new RegExp('^ {0,3}'+(m[1][0]==='`'?'`':'~')+'{'+m[1].length+',} *$');while(j<lines.length&&!close.test(lines[j]))j++;
      let body=lines.slice(i+1,j);if(j===lines.length&&body.at(-1)==='')body.pop();const pad=m[1][0]==='`'?/^ */.exec(line)[0].length:0;if(pad)body=body.map(s=>s.slice(Math.min(/^\s*/.exec(s)[0].length,pad)));
      out.push({type:'code',text:body.join('\n'),lang:unescape(m[2].trim())});i=j<lines.length?j+1:j;continue;}
    m=heading(line);
    if(m){let text=m[2].trim();text=text.replace(/(?:[ \t]+|^)#+$/,'').trim();out.push({type:'h',depth:m[1].length,text});i++;continue;}
    if(isHR(line)){out.push({type:'hr'});i++;continue;}
    if(/^ {0,3}>/.test(line)){
      let j=i;const content=[],breaks=new Set();let lazy=false,qFence=null,previousQuoted=false;
      while(j<lines.length){const s=lines[j];if(/^ {0,3}>/.test(s)){let t=s.replace(/^( {0,3}>)([ \t]+)/,(_,p,w)=>p+indent(w,p.length)).replace(/^ {0,3}> ?/,'');content.push(t);if(qFence){if(new RegExp('^ {0,3}'+qFence[0]+'{'+qFence.length+',} *$').test(t))qFence=null;lazy=false;}else {const f=fence(t);if(f)qFence=f[1];lazy=!f&&(lazyParagraph(t)||lazy&&/^(?: {4}| {0,3}\t)/.test(t));}previousQuoted=true;j++;}
        else if(s.trim()&&!interrupts(lines,j,false)&&(lazy||paragraphTail(blocks(content,Object.create(null),true,breaks)))){if(previousQuoted&&/^(?: {4}| {0,3}\t)/.test(s))breaks.add(content.length);content.push(/^ {0,3}(?:=+|-+) *$/.test(s)?'    '+s.trimStart():s);previousQuoted=false;j++;}else break;}
      out.push({type:'quote',children:blocks(content,refs,true,breaks)});i=j;continue;
    }
    m=bullet(line);
    if(m){
      const ordered=m[2].length>1, mark=ordered?m[2].at(-1):m[2];const items=[];let loose=false;
      while(i<lines.length){const b=bullet(lines[i]);if(!b||isHR(lines[i])||(b[2].length>1)!==ordered||(ordered?b[2].at(-1):b[2])!==mark)break;
        const first=i, prefix=b[1].length+b[2].length;let rest=indent(b[3],prefix);let empty=!rest.trim();let width=empty?prefix+1:prefix+Math.min(/^ */.exec(rest)[0].length,4);if(!empty&&/^ */.exec(rest)[0].length>4)width=prefix+1;
        let content=empty?'':rest.slice(width-prefix);const body=[content];i++;
        if(empty&&i<lines.length&&!lines[i].trim()){body.push('');i++;}
        else {const limit=Math.min(3,Math.max(0,width-1));const specialRe=new RegExp('^ {0,'+limit+'}(?:#{1,6}(?:\\s|$)|>|`{3,}|~{3,})');while(i<lines.length){const raw=lines[i], expanded=indent(raw);const pad=/^ */.exec(expanded)[0].length;
          const special=specialRe.test(raw)||htmlStart(raw,true)&&/^ */.exec(raw)[0].length<=limit;
          const nb=bullet(raw);if(special||nb&&nb[1].length<=limit||isHR(raw)&&/^ */.exec(raw)[0].length<=limit)break;
          if(pad>=width||!raw.trim()){body.push(expanded.slice(width));i++;}
          else {if(empty||/^ {4}/.test(rest)||/^ {0,3}(?:`{3,}|~{3,})/.test(content)||!lazyParagraph(content))break;body.push(/^ {0,3}(?:=+|-+) *$/.test(raw)?'    '+raw.trimStart():raw);i++;}
          empty=!raw.trim();content=expanded.slice(width);
        }}
        const tailBlank=body.length>1&&!body.at(-1).trim();const next=bullet(lines[i]||'');if(tailBlank&&next&&(next[2].length>1)===ordered&&(ordered?next[2].at(-1):next[2])===mark)loose=true;
        let trailing=0;while(body.length&&!body.at(-1).trim()){body.pop();trailing++;}
        if(trailing&&!bullet(lines[i]||''))i-=trailing;
        const children=blocks(body,refs,false);if(trailing&&next&&(next[2].length>1)===ordered&&(ordered?next[2].at(-1):next[2])===mark&&children.at(-1)?.type==='html'&&!htmlStart(children.at(-1).text.split('\n')[0])?.blank&&!children.at(-1).text.endsWith('\n'))children.at(-1).text+='\n';if(children.some((n,k)=>n.type==='space'&&k>0&&k<children.length-1))loose=true;
        let task=null;
        if(/^\[[ xX]\][ \t]+\S/.test(body.join('\n'))&&children[0]&&['text','p'].includes(children[0].type)){task=body[0][1]!==' ';children[0].text=children[0].text.replace(/^\[[ xX]\][ \t]+/,'');}
        items.push({children,task});
        if(i===first)i++;
      }
      out.push({type:'list',ordered,start:+m[2].slice(0,-1),items,loose});top=true;continue;
    }
    const hs=htmlStart(line);
    if(hs){let j=i;if(hs.blank){while(j<lines.length&&lines[j].trim())j++;if(j<lines.length)j++;}else {while(j<lines.length){if(hs.end.test(lines[j++]))break;}}
      while(j<lines.length&&(hs.blank?/^ *$/.test(lines[j]):lines[j]===''))j++;
      let raw=lines.slice(i,j).join('\n')+(j<lines.length?'\n':'');
      const trimmed=raw.replace(/\n[ \t]*\n[ \t\n]*$/,'');
      out.push({type:'html',text:trimmed});if(trimmed!==raw)out.push({type:'space',n:2});i=j;continue;}
    const def=definition(lines,i);
    if(def){const prev=out.at(-1);if(prev&&['p','text'].includes(prev.type))prev.text+='\n'+lines.slice(i,i+def.n).join('\n');else {if(!refs[def.key])refs[def.key]=def;out.push({type:'def'});}i+=def.n;continue;}
    const table=tableAt(lines,i);
    if(table){let j=i+2, rows=[];while(j<lines.length&&!tableStop(lines[j]))rows.push(cells(lines[j++],table.heads.length));out.push({type:'table',...table,rows});i=j;continue;}
    let j=i+1;while(j<lines.length&&!(forced?.has(j))&&(lines[j].trim()||j===lines.length-1&&lines[j].length)&&!interrupts(lines,j)&&!/^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[j]))j++;
    if(j<lines.length&&/^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[j])){out.push({type:'h',depth:lines[j].trim()[0]==='='?1:2,text:lines.slice(i,j).join('\n').trim()});i=j+1;continue;}
    if(!top)j=i+1;
    const text=lines.slice(i,j).join('\n');const prev=out.at(-1);
    if(!top&&prev?.type==='text'||forced&&prev?.type==='p')prev.text+='\n'+text;else out.push({type:top?'p':'text',text});i=j;
  }
  return out;
}
function linkAt(s, pos, refs, referenceOnly=false) {
  const image=s[pos]==='!';const start=pos+(image?2:1);if(s[start-1]!=='[')return null;
  let depth=1,j=start;
  for(;j<s.length;j++){
    const c=s[j];if(c==='\\'){j++;continue;}
    if(c==='`'){let end=j+1;while(s[end]==='`')end++;if(s[end]===']'&&end-j>=2){j=end-1;continue;}let k=s.indexOf('`',end);if(k<0)return null;while(s[k]==='`')k++;j=k-1;continue;}
    if(c==='<'){const t=tagPattern.exec(s.slice(j))||/^<[^\s<>]+>/.exec(s.slice(j));if(t){j+=t[0].length-1;continue;}}
    if(c==='[')depth++;if(c===']'&&!--depth)break;
  }
  if(j>=s.length)return null;
  const label=s.slice(start,j);let end=j+1, dest,title='';
  if(s[end]==='('&&!referenceOnly){
    let k=end+1;while(/[ \t\n]/.test(s[k]||'\0'))k++;
    if(s[k]==='<'){let q=k+1;for(;q<s.length;q++){if(s[q]==='\\'){q++;continue;}if(s[q]==='>'||s[q]==='<'||s[q]==='\n')break;}if(s[q]!=='>')return null;dest=s.slice(k+1,q);k=q+1;}
    else {let q=k,nest=0;for(;q<s.length;q++){if(s[q]==='\\'){q++;continue;}if(s[q]==='(')nest++;if(s[q]===')'){if(!nest)break;nest--;}if(/[ \t\n\x00-\x1f]/.test(s[q]))break;}if(nest)return null;dest=s.slice(k,q);k=q;}
    const ws=k;while(/[ \t\n]/.test(s[k]||'\0'))k++;
    if(k>ws&&['"',"'",'('].includes(s[k])){const quote=s[k]==='('?')':s[k];let q=k+1;for(;q<s.length;q++){if(s[q]==='\\'){q++;continue;}if(s[q]===quote)break;}if(q>=s.length)return null;title=s.slice(k+1,q);k=q+1;while(/[ \t\n]/.test(s[k]||'\0'))k++;}
    if(s[k]!==')')return null;end=k+1;
  } else {
    let key=label;
    if(s[end]==='['){let q=end+1;for(;q<s.length;q++){if(s[q]==='\\'){q++;continue;}if(s[q]===']'||s[q]==='[')break;}if(s[q]===']'){key=s.slice(end+1,q)||label;end=q+1;}}
    const def=refs[labelKey(key)];if(!def)return null;dest=def.href;title=def.title;
  }
  return {label:label.replace(/\\([\[\]])/g,'$1'),dest:unescape(dest),title:unescape(title),end,image};
}
function urlAt(s,p){
  let m=/^(?:https?:\/\/|ftp:\/\/|www\.)(?:[A-Za-z0-9-]+\.?)+[^\s<]*/i.exec(s.slice(p));
  if(m&&(!/^[wW]{3}\./.test(m[0])||m[0].startsWith('www.'))&&(!/^www\./.test(m[0])||p===0||/[\s*_~(]/.test(s[p-1]))){let text=m[0];let old;do {old=text;text=text.replace(/&[a-zA-Z0-9]+;$/,'').replace(/[?!.,:;*_'"~]+$/,'');let valid='',q=0;while(q<text.length){if(text[q]==='('){const close=text.indexOf(')',q+1);if(close>=0){valid+=text.slice(q,close+1);q=close+1;continue;}break;}if(text[q]===')'&&q===text.length-1)break;valid+=text[q++];}text=valid;}while(old!==text);return {text,dest:text.startsWith('www.')?'http://'+text:text};}
  m=/^(?:(?:mailto|xmpp):)?[A-Za-z0-9._+-]+@[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*[A-Za-z0-9])+(?![\w-])(?:\/[A-Za-z0-9@.]+)?/.exec(s.slice(p));
  if(m){const text=m[0];return {text,dest:/^(mailto|xmpp):/.test(text)?text:'mailto:'+text};}
  return null;
}
function codeAt(s,i){
  let j=i;while(s[j]==='`')j++;const run=s.slice(i,j);let end=s.indexOf(run,j);
  while(end>=0&&(s[end-1]==='`'||s[end+run.length]==='`'))end=s.indexOf(run,end+1);
  return end<0?null:{start:j,end,stop:end+run.length};
}
function hasExplicit(s,refs){for(let i=0;i<s.length;i++){if(s[i]==='['||s[i]==='!'&&s[i+1]==='['){const l=linkAt(s,i,refs);if(l){if(!l.image&&!s.slice(i,l.end).endsWith('[]'))return true;i=l.end-1;}}}return false;}
function maskableLabel(s){for(let i=0;i<s.length;i++){if(s[i]==='`'){let j=i;while(s[j]==='`')j++;const k=s.indexOf('`',j);if(k<0||k===j)return false;let end=k;while(s[end]==='`')end++;if(end-k!==j-i)return false;i=end-1;}}return true;}
const maskFirst=/[`\\]/g;
const maskSecond=/[`[<]/g;
// Preserve offsets while hiding syntax that must not participate in emphasis.
function masked(s,refs){
  if(!/[`\\<\[]/.test(s))return s;
  let pieces=[],last=0;
  for(let i=s.indexOf('[');i>=0;i=s.indexOf('[',i+1)){const l=linkAt(s,i,refs,true);if(l&&(s[l.end]!=='('||s.slice(i,l.end).includes(']['))&&!hasExplicit(l.label,refs)){pieces.push(s.slice(last,i),'['+'a'.repeat(l.end-i-2)+']');last=l.end;i=l.end-1;}}
  if(pieces.length)s=pieces.join('')+s.slice(last);
  pieces=[];last=0;
  maskFirst.lastIndex=0;
  for(let m;(m=maskFirst.exec(s));){
    const i=m.index;
    if(s[i]==='\\'&&punctuation.test(s[i+1]||'')){pieces.push(s.slice(last,i),'++');last=i+2;maskFirst.lastIndex=last;continue;}
    if(s[i]==='`'){const c=codeAt(s,i);if(c){pieces.push(s.slice(last,c.start),s.slice(c.start,c.end).replace(/`/g,'+'));last=c.end;maskFirst.lastIndex=c.stop;}else {let j=i+1;while(s[j]==='`')j++;maskFirst.lastIndex=j;}}
  }
  const first=pieces.length?pieces.join('')+s.slice(last):s;
  pieces=[];last=0;maskSecond.lastIndex=0;
  const hide=(i,end)=>{pieces.push(first.slice(last,i),'['+'a'.repeat(end-i-2)+']');last=end;maskSecond.lastIndex=end;};
  for(let m;(m=maskSecond.exec(first));){
    const i=m.index;
    if(first[i]==='['){const l=linkAt(first,i,refs);if(l&&!/[\[\]]/.test(l.label)&&!hasExplicit(l.label,refs)&&maskableLabel(l.label)){hide(i,l.end);continue;}}
    if(first[i]==='`'){let j=i;while(first[j]==='`')j++;let k=first.indexOf('`',j);if(k>=0){let end=k;while(first[end]==='`')end++;if(end-k===j-i){hide(i,end);continue;}}maskSecond.lastIndex=j;}
    if(first[i]==='<'&&first[i+1]!==' '){const end=first.indexOf('>',i+1);if(end>=0&&!first.slice(i+1,end).includes('<'))hide(i,end+1);}
  }
  return pieces.length?pieces.join('')+first.slice(last):first;
}
function flanking(s,i,end,c,tildeOrdinary=false){
  const prev=i?[...s.slice(Math.max(0,i-2),i)].at(-1):'',next=end<s.length?String.fromCodePoint(s.codePointAt(end)):'';
  const bw=!prev||/\s/.test(prev),aw=!next||/\s/.test(next),bp=!!prev&&punctuation.test(prev)&&(!tildeOrdinary||prev!=='~'),ap=!!next&&punctuation.test(next)&&(!tildeOrdinary||next!=='~');
  let open=!aw&&(!ap||bw||bp),close=!bw&&(!bp||aw||ap);
  if(c==='_'){const left=open;open=open&&(!close||bp);close=close&&(!left||ap);}
  return {open,close,prev,next,bp,ap};
}
// Resolve from each opener; marked balances nested runs before consuming a pair.
function emphasis(s,mask,i){
  const c=s[i];let j=i;while(s[j]===c)j++;const size=j-i;if(c==='~'&&size>2)return null;
  let runStart=i;while(runStart>0&&s[runStart-1]===c)runStart--;const f=flanking(s,runStart,j,c);if(!f.open)return null;
  let balance=size,skipped=0;
  let ignore=-1;
  if(c!=='~'){const other=c==='*'?'_':'*';let p=j;while(p<mask.length&&mask[p]!=='*'&&mask[p]!=='_')p++;if(mask.slice(p,p+2)===other+other){p+=2;while(p<mask.length&&mask[p]!=='*'&&mask[p]!=='_')p++;const candidate=p;if(mask[p]===c&&mask[p+1]!==c){p++;while(p<mask.length&&mask[p]!=='*'&&mask[p]!=='_')p++;if(mask.slice(p,p+2)===other+other)ignore=candidate;}}}
  for(let k=j;k<mask.length;k++){
    if(mask[k]!==c||k===ignore)continue;let end=k+1;while(mask[end]===c)end++;
    const n=end-k,g=flanking(mask,k,end,c,c==='*');
    if(c==='~'&&n!==size){k=end-1;continue;}
    if(g.open&&!g.close)balance+=n;
    else if(g.close){
      if(c==='*'&&i>runStart&&g.open)return null;
      if(c!=='~'&&g.open&&(j-runStart)%3&&((j-runStart)+n)%3===0){skipped+=n;k=end-1;continue;}
      balance-=n;
      if(balance<=0){const used=Math.min(n,n+balance+skipped),take=c==='~'?size:Math.min(size,used)%2?1:2;return {end:k+used,take,tag:c==='~'?'del':take===2?'strong':'em'};}
    }
    k=end-1;
  }
  return null;
}
// Jump over ordinary text, stopping at syntax or a possible automatic link.
const inlineBoundary=/[\\<!\[`*_~]| {2,}\n|(?:[hH][tT][tT][pP][sS]?|[fF][tT][pP]):\/\/|www\.|(?:mailto|xmpp):|(?<![A-Za-z0-9._+-])[A-Za-z0-9._+-]+@/g;
function inline(s, refs, state={inLink:false,raw:false}, plain=false){
  const output=[];let pending='',pendingRaw=false;let i=0;const mask=/[*_~]/.test(s)?masked(s,refs):s;
  const flush=()=>{if(pending){output.push(plain||pendingRaw?pending:escape(numeric(pending)));pending='';}};
  const text=(v,raw=false)=>{if(pendingRaw!==raw)flush();pendingRaw=raw;pending+=v;};
  const emit=v=>{flush();output.push(v);};
  while(i<s.length){
    const c=s[i];
    if(c==='\\'&&i+1<s.length&&/[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/.test(s[i+1])){emit(plain?s[i+1]:escape(s[i+1],true));i+=2;continue;}
    if(c==='<'){
      const tag=tagPattern.exec(s.slice(i));
      if(tag){emit(tag[0]);if(/^<a /i.test(tag[0]))state.inLink=true;if(/^<\/a>/i.test(tag[0]))state.inLink=false;if(/^<(?:pre|code|kbd|script)(?:\s|>)/i.test(tag[0]))state.raw=true;if(/^<\/(?:pre|code|kbd|script)(?:\s|>)/i.test(tag[0]))state.raw=false;i+=tag[0].length;continue;}
    }
    if(c==='['||c==='!'&&s[i+1]==='['){const l=linkAt(s,i,refs)||linkAt(s,i,refs,true);if(l){const childState={inLink:true,raw:state.raw};const child=inline(l.label,refs,childState,plain||l.image);if(l.image||!childState.emitted){const h0=href(l.dest),h=h0===null?null:escape(h0);let value;
          if(l.image)value=h===null?escape(child):'<img src="'+h+'" alt="'+escape(child)+'"'+(l.title?' title="'+escape(l.title)+'"':'')+'>';
          else value=h===null?child:'<a href="'+h+'"'+(l.title?' title="'+escape(l.title)+'"':'')+'>'+child+'</a>';
          emit(plain?child:value);if(!l.image)state.emitted=true;i=l.end;continue;}}
    }
    if(c==='`'){
      let j=i;while(s[j]==='`')j++;const run=s.slice(i,j);let end=s.indexOf(run,j);
      while(end>=0&&(s[end-1]==='`'||s[end+run.length]==='`'))end=s.indexOf(run,end+1);
      if(end>=0){let v=s.slice(j,end).replace(/\n/g,' ');if(v.startsWith(' ')&&v.endsWith(' ')&&/[^ ]/.test(v))v=v.slice(1,-1);emit(plain?v:'<code>'+escape(v,true)+'</code>');i=end+run.length;continue;}
      text(run,state.raw);i=j;continue;
    }
    if((c===' '||c==='\\')&&s.indexOf('\n',i)>=0){const br=/^(?: {2,}|\\)\n(?!\s*$)[ \t]*/.exec(s.slice(i));if(br){emit(plain?'':'<br>');i+=br[0].length;continue;}}
    if(c==='*'||c==='_'||c==='~'){
      const e=emphasis(s,mask,i);
      if(e){const body=inline(s.slice(i+e.take,e.end-e.take),refs,state,plain);emit(plain?body:'<'+e.tag+'>'+body+'</'+e.tag+'>');i=e.end;continue;}
      text(c,state.raw);i++;continue;
    }

    if(c==='<'){
      const m=/^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s\x00-\x1f<>]*|[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+)>/.exec(s.slice(i));
      if(m){const v=m[1],dest=/^[^:]+@/.test(v)?'mailto:'+v:v;emit(plain?v:'<a href="'+escape(href(dest))+'">'+escape(v)+'</a>');i+=m[0].length;continue;}
    }
    if(!state.inLink&&/[A-Za-z0-9]/.test(c)){
      const u=urlAt(s,i);if(u){emit(plain?u.text:'<a href="'+escape(href(u.dest))+'">'+escape(u.text)+'</a>');state.emitted=true;i+=u.text.length;continue;}
    }
    inlineBoundary.lastIndex=i+1;const boundary=inlineBoundary.exec(s);const j=boundary?boundary.index:s.length;
    text(s.slice(i,j),state.raw);i=j;
  }
  flush();return output.join('');
}

function renderInline(s,refs){const state=refs[inlineState];state.raw=false;return inline(s,refs,state);}
function render(nodes, refs, tight=false){
  let out='';
  for(const n of nodes){switch(n.type){
    case 'space':break;
    case 'p':case 'text':out+=(tight?'':'<p>')+renderInline(n.text,refs)+(tight?'':'</p>\n');break;
    case 'h':out+='<h'+n.depth+'>'+renderInline(n.text,refs)+'</h'+n.depth+'>\n';break;
    case 'hr':out+='<hr>\n';break;
    case 'code':{const lang=(n.lang||'').split(/\s/,1)[0];const body=n.text?n.text.replace(/\n$/,'')+'\n':'';out+='<pre><code'+(lang?' class="language-'+escape(lang)+'"':'')+'>'+escape(body,true)+'</code></pre>\n';break;}
    case 'html':out+=n.text;break;
    case 'quote':out+='<blockquote>\n'+render(n.children,refs)+'</blockquote>\n';break;
    case 'list':{const tag=n.ordered?'ol':'ul';out+='<'+tag+(n.ordered&&n.start!==1?' start="'+n.start+'"':'')+'>\n';for(const item of n.items){let children=item.children;const cb=item.task===null?'':'<input '+(item.task?'checked="" ':'')+'disabled="" type="checkbox"> ';
      let body=render(children,refs,!n.loose);if(cb){if(n.loose&&body.startsWith('<p>'))body='<p>'+cb+body.slice(3);else body=cb+body;}
      out+='<li>'+body+'</li>\n';}out+='</'+tag+'>\n';break;}
    case 'table':{out+='<table>\n<thead>\n<tr>\n';const row=(v,tag)=>v.map((t,i)=>'<'+tag+(n.align[i]?' align="'+n.align[i]+'"':'')+'>'+renderInline(t,refs)+'</'+tag+'>\n').join('');out+=row(n.heads,'th')+'</tr>\n</thead>\n';if(n.rows.length){out+='<tbody>';for(const r of n.rows)out+='<tr>\n'+row(r,'td')+'</tr>\n';out+='</tbody>';}out+='</table>\n';break;}
  }}return out;
}
/** Render one Markdown string using fresh document-local parsing state. */
export function parse(markdown){
  const refs=Object.create(null);refs[inlineState]={inLink:false,raw:false};
  return render(blocks(markdown.replace(/\r\n?/g,'\n').split('\n'),refs),refs);
}
