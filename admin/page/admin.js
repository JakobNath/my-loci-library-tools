// The admin page's buttons: each asks the laptop's admin server (admin.mjs)
// to run one tool, and shows what the tool printed when it finishes.

const output = document.querySelector('.output');

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-tool]');
  if (!button) return;
  if (button.dataset.confirm && !window.confirm(button.dataset.confirm)) return;
  const tools = button.closest('.tools');
  const input = { file: tools.querySelector('[name="file"]').value, full: tools.querySelector('[name="full"]').checked };
  const buttons = [...document.querySelectorAll('[data-tool]')];
  buttons.forEach(item => { item.disabled = true; });
  output.hidden = false;
  output.textContent = `${button.textContent}: running. This can take a few minutes; leave the page open.`;
  try {
    const response = await fetch('/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: button.dataset.tool, input }) });
    const result = await response.json();
    output.textContent = `${button.textContent}: ${result.ok ? 'finished' : 'stopped'}.\n\n${result.output}`;
  } catch (error) {
    output.textContent = `${button.textContent} could not be run: ${error.message}. Is the admin window still open?`;
  } finally {
    buttons.forEach(item => { item.disabled = false; });
  }
});
