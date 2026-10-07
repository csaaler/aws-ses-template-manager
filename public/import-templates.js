$(document).ready(() => {
  const region = localStorage.getItem('region');
  if (!region) {
    window.location.href = '/';  // the region is chosen on the templates page
    return;
  }

  const { validateTemplateFile, rowStatuses, summarize } = window.ImportValidation;

  // one row per selected file: { id, fileName, result, name, outcome? }
  let rows = [];
  let nextRowId = 1;
  let existingNames = new Set();
  let phase = 'edit';  // 'edit' | 'importing' | 'done'

  $('#importRegion').text(region);

  $.get(`/list-templates?${regionQuery()}`, (data) => {
    existingNames = new Set(data.items.TemplatesMetadata.map((t) => t.Name));
    refreshStatuses();
  }).fail((xhr) => {
    // without the list we can't mark conflicts up front; creating an existing name still triggers the dialog
    const message = xhr.responseJSON?.message || `${xhr.status} ${xhr.statusText}`;
    $('#existingLoadError')
      .text(`Couldn't check which templates already exist (${message}). Conflicts will be detected during the import.`)
      .removeClass('d-none');
  });

  // complete rows first, incomplete ones at the bottom; selection order is kept within each group
  const orderedRows = () => [...rows.filter((r) => r.result.ok), ...rows.filter((r) => !r.result.ok)];

  // ----- file selection -----

  $('#selectFilesCta, #addFilesCta').on('click', () => $('#importFileInput').trigger('click'));

  $('#importFileInput').on('change', async function () {
    const files = [...this.files];
    this.value = '';  // allows selecting the same files again later
    const read = await Promise.all(files.map(async (file) => ({ fileName: file.name, text: await file.text() })));

    for (const { fileName, text } of read) {
      const result = validateTemplateFile(fileName, text);
      const row = {
        id: nextRowId++,
        fileName,
        result,
        name: result.ok ? result.template.TemplateName : result.name
      };
      const index = rows.findIndex((r) => r.fileName === fileName);
      if (index >= 0) {
        rows[index] = row;  // re-selecting a file replaces its row
      } else {
        rows.push(row);
      }
    }
    renderTable();
  });

  // ----- overview -----

  const STATUS_BADGES = {
    new: ['badge-success', 'New'],
    exists: ['badge-warning', 'Exists – will ask'],
    'invalid-name': ['badge-danger', 'Invalid name'],
    'duplicate-name': ['badge-danger', 'Duplicate name in this import'],
    incomplete: ['badge-secondary', 'Incomplete'],
    working: ['badge-light', 'Importing…'],
    created: ['badge-success', 'Created'],
    replaced: ['badge-info', 'Replaced'],
    skipped: ['badge-secondary', 'Skipped'],
    failed: ['badge-danger', 'Failed']
  };

  const STATUS_DETAILS = {
    'invalid-name': 'Letters, numbers, _ and - only, max 64 characters'
  };

  function statusHtml(status, detail) {
    const [badgeClass, label] = STATUS_BADGES[status];
    const detailHtml = detail ? `<div class="small text-muted mt-1">${escapeHtml(detail)}</div>` : '';
    return `<span class="badge ${badgeClass}">${label}</span>${detailHtml}`;
  }

  function renderTable() {
    const html = orderedRows().map((row) => {
      const { ok } = row.result;
      const subject = ok ? row.result.template.SubjectPart : row.result.subject;
      const nameCell = ok
        ? `<input type="text" class="form-control form-control-sm js-template-name" value="${escapeHtml(row.name)}" aria-label="Template name for ${escapeHtml(row.fileName)}">`
        : (row.name ? escapeHtml(row.name) : '<span class="text-muted">—</span>');
      return `
        <tr data-row-id="${row.id}" class="${ok ? '' : 'text-muted table-light'}">
          <td class="text-break">${escapeHtml(row.fileName)}</td>
          <td>${nameCell}</td>
          <td class="text-break">${subject ? escapeHtml(subject) : '<span class="text-muted">—</span>'}</td>
          <td class="js-status"></td>
          <td class="text-right text-nowrap">
            ${ok ? '<a href="#" class="js-preview mr-2">Preview</a>' : ''}
            <button type="button" class="close float-none js-remove-row" aria-label="Remove ${escapeHtml(row.fileName)}">&times;</button>
          </td>
        </tr>`;
    }).join('');

    $('#importTable tbody').html(html);
    $('#importTable, #importFooter').toggleClass('d-none', rows.length === 0);
    $('#importEmptyState').toggleClass('d-none', rows.length > 0);
    $('#addFilesCta').toggleClass('d-none', rows.length === 0);
    $('#fileCount').text(rows.length ? `${rows.length} file${rows.length === 1 ? '' : 's'} selected` : '');
    refreshStatuses();
  }

  // Updates status cells, summary and the Import button without re-rendering inputs, so typing keeps focus
  function refreshStatuses() {
    if (phase !== 'edit') return;
    const ordered = orderedRows();
    const statuses = rowStatuses(ordered.map((r) => ({ ok: r.result.ok, name: r.name })), existingNames);
    ordered.forEach((row, i) => {
      const detail = statuses[i] === 'incomplete' ? row.result.reason : STATUS_DETAILS[statuses[i]];
      $(`tr[data-row-id="${row.id}"] .js-status`).html(statusHtml(statuses[i], detail));
    });

    const summary = summarize(statuses);
    const parts = [`${summary.ready} ready`];
    if (summary.conflicts) parts.push(`${summary.conflicts} need${summary.conflicts === 1 ? 's' : ''} a decision (already exist${summary.conflicts === 1 ? 's' : ''})`);
    if (summary.blocked) parts.push(`${summary.blocked} need${summary.blocked === 1 ? 's' : ''} a name fix`);
    if (summary.excluded) parts.push(`${summary.excluded} won't be imported`);
    $('#importSummary').text(parts.join(' · '));
    $('#importCta')
      .text(`Import ${summary.importable} template${summary.importable === 1 ? '' : 's'}`)
      .prop('disabled', !summary.canImport);
  }

  const rowFor = (element) => rows.find((r) => r.id === Number($(element).closest('tr').attr('data-row-id')));

  $('#importTable').on('input', '.js-template-name', function () {
    rowFor(this).name = this.value.trim();
    refreshStatuses();
  });

  $('#importTable').on('click', '.js-remove-row', function () {
    const row = rowFor(this);
    rows = rows.filter((r) => r !== row);
    renderTable();
  });

  $('#importTable').on('click', '.js-preview', function (e) {
    e.preventDefault();
    const row = rowFor(this);
    $('#previewModalTitle').text(`Preview: ${row.name || row.fileName}`);
    $('#previewModal')
      .one('shown.bs.modal', () => setTemplatePreview(row.result.template.HtmlPart))
      .modal('show');
  });
  $('#previewModal').on('hidden.bs.modal', () => setTemplatePreview(''));

  // ----- import -----

  // resolves to { ok } or { ok: false, code, message }, never rejects
  function sendTemplate(type, url, template) {
    return new Promise((resolve) => {
      $.ajax({
        type,
        url,
        contentType: 'application/json',
        data: JSON.stringify({ ...template, region })
      }).done(() => resolve({ ok: true })).fail((xhr) => resolve({
        ok: false,
        code: xhr.responseJSON?.code,
        message: xhr.responseJSON?.message || `${xhr.status} ${xhr.statusText}`
      }));
    });
  }

  // resolves to { choice: 'replace' | 'skip', applyToAll } once the modal has fully closed,
  // so the next conflict's modal can open without fighting Bootstrap's transition
  function askAboutConflict(row) {
    return new Promise((resolve) => {
      let decision;
      $('#conflictName').text(row.name);
      $('#conflictRegion').text(region);
      $('#conflictFile').text(row.fileName);
      $('#applyToAll').prop('checked', false);

      const choose = (choice) => () => {
        decision = { choice, applyToAll: $('#applyToAll').prop('checked') };
        $('#conflictModal').modal('hide');
      };
      $('#replaceCta').off('click').on('click', choose('replace'));
      $('#skipCta').off('click').on('click', choose('skip'));
      $('#conflictModal')
        .one('hidden.bs.modal', () => resolve(decision))
        .modal('show');
    });
  }

  function setOutcome(row, outcome, detail) {
    row.outcome = outcome;
    $(`tr[data-row-id="${row.id}"] .js-status`).html(statusHtml(outcome, detail));
  }

  $('#importCta').on('click', async () => {
    phase = 'importing';
    $('#importCta, #selectFilesCta, #addFilesCta').prop('disabled', true);
    $('#importTable .js-template-name, #importTable .js-remove-row').prop('disabled', true);
    $('#importSummary').text('Importing…');

    let rememberedChoice = null;
    for (const row of orderedRows().filter((r) => r.result.ok)) {
      setOutcome(row, 'working');
      const template = { ...row.result.template, TemplateName: row.name };

      let conflict = existingNames.has(row.name);
      if (!conflict) {
        const created = await sendTemplate('POST', '/create-template', template);
        if (created.ok) {
          setOutcome(row, 'created');
          continue;
        }
        if (created.code !== 'AlreadyExistsException') {
          setOutcome(row, 'failed', created.message);
          continue;
        }
        conflict = true;  // created by someone else since the page loaded
      }

      let choice = rememberedChoice;
      if (!choice) {
        const decision = await askAboutConflict(row);
        choice = decision.choice;
        if (decision.applyToAll) rememberedChoice = choice;
      }
      if (choice === 'skip') {
        setOutcome(row, 'skipped');
        continue;
      }
      const replaced = await sendTemplate('PUT', '/update-template', template);
      setOutcome(row, replaced.ok ? 'replaced' : 'failed', replaced.message);
    }

    phase = 'done';
    const count = (outcome) => rows.filter((r) => r.outcome === outcome).length;
    $('#importSummary').text(
      `${count('created')} created · ${count('replaced')} replaced · ${count('skipped')} skipped · ${count('failed')} failed`
    );
    $('#importTable .js-remove-row').addClass('d-none');
    $('#importCta, #selectFilesCta, #addFilesCta').addClass('d-none');
    $('#backCta, #importMoreCta').removeClass('d-none');
  });

  $('#importMoreCta').on('click', () => window.location.reload());
});
