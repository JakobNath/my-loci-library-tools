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

// The shelf planner: list a place's shelves, suggest an arrangement, print it, and record it.
const planOutput = document.querySelector('.plan-output');

document.addEventListener('click', async event => {
  const planner = event.target.closest('[data-planner], [data-print-plan]');
  if (!planner) return;
  const box = planner.closest('.planner');
  if (planner.hasAttribute('data-print-plan')) {
    if (planOutput.hidden || !planOutput.textContent.trim()) { planOutput.hidden = false; planOutput.textContent = 'Suggest an arrangement first, then print it.'; return; }
    const place = box.querySelector('[name="place"]').value;
    const sheet = window.open('', '_blank');
    sheet.document.title = `Shelf plan: ${place}`;
    const heading = sheet.document.createElement('h1');
    heading.textContent = `Shelf plan: ${place}`;
    const text = sheet.document.createElement('pre');
    text.textContent = planOutput.textContent;
    text.style.font = '11pt/1.5 Georgia, serif';
    text.style.whiteSpace = 'pre-wrap';
    sheet.document.body.append(heading, text);
    sheet.print();
    return;
  }
  if (planner.dataset.confirm && !window.confirm(planner.dataset.confirm)) return;
  const asked = { action: planner.dataset.planner, place: box.querySelector('[name="place"]').value, shelves: box.querySelector('[name="shelves"]').value, order: box.querySelector('[name="order"]').value };
  const buttons = [...box.querySelectorAll('button')];
  buttons.forEach(item => { item.disabled = true; });
  planOutput.hidden = false;
  planOutput.textContent = 'Working…';
  try {
    const response = await fetch('/planner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(asked) });
    const result = await response.json();
    if (asked.action === 'shelves' && result.ok) {
      box.querySelector('[name="shelves"]').value = result.output;
      planOutput.textContent = result.output ? 'Fill in each width in cm (measure the inside of the shelf), put the shelves in order, then suggest an arrangement.' : 'No shelves found there. Type them, one per line, such as "Home › Office › Case 1 › Shelf 1 = 80".';
    } else {
      planOutput.textContent = result.output;
    }
  } catch (error) {
    planOutput.textContent = `The planner could not be reached: ${error.message}. Is the admin window still open?`;
  } finally {
    buttons.forEach(item => { item.disabled = false; });
  }
});

// Printed shelf lists: a page of their own, opened beside this one, to print from the browser.
document.addEventListener('click', event => {
  if (!event.target.closest('[data-print-lists]')) return;
  const box = event.target.closest('.planner');
  const place = box.querySelector('[name="place"]').value.trim();
  if (!place) { planOutput.hidden = false; planOutput.textContent = 'Name the place first, such as "Home › Office › Case 1".'; return; }
  const order = box.querySelector('[name="list-order"]').value;
  window.open(`/print?place=${encodeURIComponent(place)}&order=${order}`, '_blank');
});
