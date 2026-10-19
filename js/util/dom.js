export function h(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  Object.entries(attributes).forEach(([name, value]) => applyAttribute(element, name, value));
  appendChildren(element, children);
  return element;
}

function applyAttribute(element, name, value) {
  if (value === false || value === undefined) return;
  if (name.startsWith('on') && typeof value === 'function') element.addEventListener(name.slice(2), value);
  else if (name === 'class') element.className = value;
  else if (name === 'dataset') Object.assign(element.dataset, value);
  else if (value === true) element.setAttribute(name, '');
  else element.setAttribute(name, String(value));
}

function appendChildren(element, children) {
  children.flat(Infinity).forEach((child) => {
    if (child === undefined || child === false || child === '') return;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
}

export function replaceContent(container, ...children) {
  container.replaceChildren();
  appendChildren(container, children);
}

export function table(headers, rows, options = {}) {
  return h('div', { class: 'table-wrap' },
    h('table', { class: options.class || 'data-table' },
      options.caption ? h('caption', {}, options.caption) : '',
      h('thead', {}, h('tr', {}, headers.map((header) => h('th', { scope: 'col' }, header)))),
      h('tbody', {}, rows.map((row) => h('tr', {}, row.map((cell) => h('td', {}, cell)))))));
}

export function badge(text, tone = 'neutral') {
  return h('span', { class: `badge badge-${tone}` }, text);
}
