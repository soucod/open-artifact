// The chat column: the transcript, the artifact cards, and the input with the command menu.
const log = document.getElementById('log');
const cards = document.getElementById('cards');
const input = document.getElementById('input');
const commands = document.getElementById('commands');

function line(text, className) {
  const div = document.createElement('div');
  div.textContent = text;
  if (className) div.className = className;
  log.append(div);
  log.scrollTop = log.scrollHeight;
}

window.chat.onLine((text) => line(text));
window.chat.onNotice((text) => line(text, 'notice'));
window.chat.onDraft((prompt) => {
  input.value = prompt;
  input.focus();
});
window.chat.onCommands((entries) => {
  commands.replaceChildren(
    ...entries.map((entry) => {
      const option = document.createElement('option');
      option.value = entry.text;
      option.label = entry.title;
      return option;
    }),
  );
});
window.chat.onCards((list) => {
  cards.replaceChildren(
    ...list.map((card) => {
      const button = document.createElement('button');
      if (card.thumbnail) {
        const img = document.createElement('img');
        img.src = card.thumbnail;
        img.alt = '';
        button.append(img);
      }
      button.append(`${card.title} (${card.type})`);
      button.onclick = () => window.chat.open(card.url);
      return button;
    }),
  );
});

document.getElementById('form').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  void window.chat.send(text);
});
