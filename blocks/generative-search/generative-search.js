/**
 * Generative Search Block
 * Integrates with Cloudflare Worker API to generate dynamic content based on user queries
 * Uses the EDS block pipeline (buildBlock/decorateBlock/loadBlock) for real block rendering.
 */

import { buildBlock, decorateBlock, loadBlock } from '../../scripts/aem.js';

// API Configuration
const API_BASE_URL = 'https://vitamix-gen-service.franklin-prod.workers.dev';

// Known pipelines (fallback when API is unreachable)
const KNOWN_PIPELINES = [
  { id: 'default', label: 'Default Pipeline' },
];

/**
 * Creates the search interface
 * @param {HTMLElement} block - The block element
 */
function createSearchInterface(block, pipelines) {
  const searchContainer = document.createElement('div');
  searchContainer.className = 'search-container';

  const pipelineOptions = pipelines
    .map((p) => `<option value="${p.id}">${p.label}</option>`)
    .join('');

  searchContainer.innerHTML = `
    <form class="search-form">
      <input
        type="text"
        class="search-input"
        placeholder="Ask me anything about Vitamix products..."
        aria-label="Search query"
        required
      />
      <button type="submit" class="search-button">
        Generate
      </button>
    </form>
    <details class="debug-panel">
      <summary>Debug Options</summary>
      <div class="debug-options">
        <label class="debug-label">
          Pipeline
          <select class="pipeline-select" aria-label="Select pipeline">
            ${pipelineOptions}
          </select>
        </label>
      </div>
    </details>
  `;

  return searchContainer;
}

/**
 * Creates a floating log widget appended to document.body
 * @returns {HTMLElement} The widget element
 */
function createLogWidget() {
  const widget = document.createElement('div');
  widget.className = 'gen-log-widget hidden';

  widget.innerHTML = `
    <div class="gen-log-header">
      <span class="gen-log-title"><span class="spinner hidden"></span>Generation Log</span>
      <button class="gen-log-toggle" aria-label="Minimize log">&#x2212;</button>
    </div>
    <div class="gen-log-body">
      <div class="status-message hidden"></div>
      <div class="generation-events hidden"></div>
    </div>
  `;

  // Toggle collapse
  const toggle = widget.querySelector('.gen-log-toggle');
  toggle.addEventListener('click', () => {
    const collapsed = widget.classList.toggle('collapsed');
    toggle.innerHTML = collapsed ? '&#x2b;' : '&#x2212;';
    toggle.setAttribute('aria-label', collapsed ? 'Expand log' : 'Minimize log');
  });

  document.body.appendChild(widget);
  return widget;
}

/**
 * Shows a status message
 * @param {HTMLElement} container - Results container
 * @param {string} message - Status message
 * @param {string} type - Message type (loading, error, success)
 */
function showStatus(widget, message, type = 'loading') {
  const statusEl = widget.querySelector('.status-message');
  const headerSpinner = widget.querySelector('.gen-log-header .spinner');
  statusEl.className = `status-message ${type}`;

  if (type === 'loading') {
    statusEl.innerHTML = `<span class="spinner"></span>${message}`;
    headerSpinner.classList.remove('hidden');
  } else {
    statusEl.textContent = message;
    headerSpinner.classList.add('hidden');
  }

  statusEl.classList.remove('hidden');
}

/**
 * Hides the status message
 * @param {HTMLElement} container - Results container
 */
function hideStatus(widget) {
  const statusEl = widget.querySelector('.status-message');
  const headerSpinner = widget.querySelector('.gen-log-header .spinner');
  statusEl.classList.add('hidden');
  headerSpinner.classList.add('hidden');
}

/**
 * Adds a generation event to the events log
 * @param {HTMLElement} container - Results container
 * @param {string} eventType - Type of event
 * @param {object} eventData - Event data
 */
function addGenerationEvent(widget, eventType, eventData) {
  const eventsEl = widget.querySelector('.generation-events');
  eventsEl.classList.remove('hidden');

  const eventItem = document.createElement('div');
  eventItem.className = 'event-item';

  // Format event data based on type
  let eventText = '';
  switch (eventType) {
    case 'intent': {
      const parts = [];
      if (eventData.pipeline) parts.push(`Pipeline: ${eventData.pipeline.label}`);
      if (eventData.classificationEngine) parts.push(`Classify: ${eventData.classificationEngine.label}`);
      if (eventData.generationEngine) parts.push(`Generate: ${eventData.generationEngine.label}`);
      eventText = `<strong>Pipeline:</strong> ${parts.join(' &middot; ') || 'Analyzing...'}`;
      break;
    }
    case 'classification':
      eventText = `<strong>Classification:</strong> ${eventData.intent || '?'} / ${eventData.category || '?'} (${Math.round((eventData.confidence || 0) * 100)}%)`;
      break;
    case 'blocks':
      eventText = `<strong>Blocks selected:</strong> ${eventData.blocks?.join(', ') || 'Selecting...'}`;
      break;
    case 'block':
      eventText = `<strong>Block:</strong> ${eventData.type || 'rendering...'}`;
      break;
    case 'content':
      eventText = `<strong>Content ready:</strong> ${eventData.blocks?.length || 0} blocks`;
      break;
    case 'complete':
      eventText = `<strong>Generation complete</strong> - Page ready`;
      break;
    default:
      eventText = `<strong>${eventType}:</strong> ${JSON.stringify(eventData)}`;
  }

  eventItem.innerHTML = eventText;
  eventsEl.appendChild(eventItem);

  // Auto-scroll to latest event
  eventItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Displays generated content using real EDS blocks.
 * Each block is built, decorated, and loaded through the standard EDS pipeline
 * so existing block CSS/JS applies automatically.
 * @param {HTMLElement} block - The generative-search block element
 * @param {Array} generatedBlocks - Array of block definitions from the worker
 */
async function displayGeneratedContent(block, generatedBlocks) {
  const section = block.closest('.section');
  const main = section ? section.parentElement : block.closest('main');

  if (!main) {
    console.error('[generative-search] Cannot find <main> element');
    return;
  }

  // Build and insert each generated block as a proper EDS section.
  // We keep the search section visible until all blocks are rendered,
  // so errors remain visible to the user.
  const rendered = [];

  for (const genBlock of generatedBlocks) {
    try {
      const newSection = document.createElement('div');
      newSection.classList.add('section');
      newSection.dataset.sectionStatus = 'loaded';

      if (genBlock.type === 'default-content') {
        const wrapper = document.createElement('div');
        wrapper.classList.add('default-content-wrapper');
        wrapper.innerHTML = genBlock.content;
        newSection.appendChild(wrapper);
      } else {
        const blockEl = buildBlock(genBlock.type, genBlock.rows);
        const wrapper = document.createElement('div');
        wrapper.appendChild(blockEl);
        newSection.appendChild(wrapper);
        decorateBlock(blockEl);
        // eslint-disable-next-line no-await-in-loop
        await loadBlock(blockEl);
      }

      main.appendChild(newSection);
      rendered.push(newSection);
      console.log(`[generative-search] Rendered ${genBlock.type} block`);
    } catch (err) {
      console.error(`[generative-search] Failed to render ${genBlock.type}:`, err);
    }
  }

  // Add a "New Search" action section
  const actionSection = document.createElement('div');
  actionSection.classList.add('section');
  actionSection.dataset.sectionStatus = 'loaded';
  const actionWrapper = document.createElement('div');
  actionWrapper.classList.add('default-content-wrapper');
  actionWrapper.style.textAlign = 'center';
  actionWrapper.style.padding = 'var(--spacing-600) 0';
  const reloadLink = document.createElement('p');
  reloadLink.className = 'button-wrapper';
  reloadLink.style.justifyContent = 'center';
  reloadLink.innerHTML = '<a class="button secondary" href="#">New Search</a>';
  reloadLink.querySelector('a').addEventListener('click', (e) => {
    e.preventDefault();
    window.location.reload();
  });
  actionWrapper.appendChild(reloadLink);
  actionSection.appendChild(actionWrapper);
  main.appendChild(actionSection);
  rendered.push(actionSection);

  // Only hide the search section after blocks rendered successfully
  if (rendered.length > 0 && section) {
    section.style.display = 'none';
  }
}

/**
 * Handles Server-Sent Events (SSE) from the generation API
 * @param {string} query - User query
 * @param {HTMLElement} widget - The floating log widget
 * @param {HTMLElement} block - The main block element
 * @param {string} [pipelineId] - Optional pipeline ID
 */
async function handleGeneration(query, widget, block, pipelineId) {
  widget.classList.remove('hidden');
  widget.classList.remove('collapsed');

  // Clear previous results
  widget.querySelector('.generation-events').innerHTML = '';

  showStatus(widget, 'Starting generation...', 'loading');

  // Variable to store the generated blocks
  let generatedBlocks = [];

  try {
    // Build API URL with query parameter
    const apiUrl = new URL('/generate', API_BASE_URL);
    apiUrl.searchParams.set('q', query);
    if (pipelineId) {
      apiUrl.searchParams.set('pipeline', pipelineId);
    }

    // Create EventSource for SSE
    const eventSource = new EventSource(apiUrl.toString());

    eventSource.addEventListener('intent', (event) => {
      const data = JSON.parse(event.data);
      addGenerationEvent(widget, 'intent', data);
      showStatus(widget, 'Analyzing your request...', 'loading');
    });

    eventSource.addEventListener('classification', (event) => {
      const data = JSON.parse(event.data);
      addGenerationEvent(widget, 'classification', data);
      showStatus(widget, 'Determining content type...', 'loading');
    });

    eventSource.addEventListener('blocks', (event) => {
      const data = JSON.parse(event.data);
      addGenerationEvent(widget, 'blocks', data);
      showStatus(widget, 'Generating content blocks...', 'loading');
    });

    eventSource.addEventListener('block', (event) => {
      const data = JSON.parse(event.data);
      addGenerationEvent(widget, 'block', data);
      showStatus(widget, 'Building your page...', 'loading');
    });

    eventSource.addEventListener('content', (event) => {
      const data = JSON.parse(event.data);
      addGenerationEvent(widget, 'content', data);
      showStatus(widget, 'Building page with real blocks...', 'loading');

      // Store the generated blocks
      generatedBlocks = data.blocks || [];
    });

    eventSource.addEventListener('complete', (event) => {
      const data = JSON.parse(event.data);
      addGenerationEvent(widget, 'complete', data);

      // Close the event source
      eventSource.close();

      // Hide loading status and display generated content using EDS blocks
      hideStatus(widget);

      if (generatedBlocks.length > 0) {
        displayGeneratedContent(block, generatedBlocks).then(() => {
          // Auto-collapse the widget after blocks render
          widget.classList.add('collapsed');
          widget.querySelector('.gen-log-toggle').innerHTML = '&#x2b;';
        }).catch((error) => {
          console.error('Error rendering blocks:', error);
          showStatus(widget, 'Error displaying content', 'error');
        });
      } else {
        showStatus(widget, 'No content was generated', 'error');
      }
    });

    eventSource.addEventListener('error', (event) => {
      let errorMsg = 'Generation failed';
      try {
        const data = JSON.parse(event.data);
        errorMsg = data.message || errorMsg;
      } catch (e) {
        // Error parsing error message
      }

      showStatus(widget, errorMsg, 'error');
      eventSource.close();
    });

    eventSource.onerror = () => {
      showStatus(widget, 'Connection error. Please try again.', 'error');
      eventSource.close();
    };

  } catch (error) {
    showStatus(widget, `Error: ${error.message}`, 'error');
  }
}

/**
 * Decorates the generative search block
 * @param {HTMLElement} block - The block element
 */
/**
 * Fetches available pipelines from the API config
 * @returns {Promise<Array>} Array of pipeline objects
 */
async function fetchPipelines() {
  try {
    const resp = await fetch(new URL('/admin/api/config/pipelines', API_BASE_URL));
    if (resp.ok) {
      const data = await resp.json();
      const pipelines = data.value || data;
      if (Array.isArray(pipelines) && pipelines.length > 0) {
        return pipelines.filter((p) => p.enabled !== false);
      }
    }
  } catch (e) {
    console.warn('[generative-search] Could not fetch pipelines, using defaults', e);
  }
  return KNOWN_PIPELINES;
}

export default async function decorate(block) {
  // Get optional title from block content BEFORE clearing
  const title = block.textContent.trim() || 'AI-Powered Content Generator';

  // Clear existing content
  block.innerHTML = '';

  // Fetch available pipelines (non-blocking, falls back to defaults)
  const pipelines = await fetchPipelines();

  // Create title
  const titleEl = document.createElement('h2');
  titleEl.textContent = title;

  // Create search interface with pipeline selector
  const searchContainer = createSearchInterface(block, pipelines);

  // Create floating log widget (appended to body, not the block)
  const logWidget = createLogWidget();

  // Assemble block
  block.appendChild(titleEl);
  block.appendChild(searchContainer);

  // Handle form submission
  const form = searchContainer.querySelector('.search-form');
  const input = searchContainer.querySelector('.search-input');
  const button = searchContainer.querySelector('.search-button');
  const pipelineSelect = searchContainer.querySelector('.pipeline-select');

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const query = input.value.trim();
    if (!query) return;

    const selectedPipeline = pipelineSelect.value;

    // Disable form during generation
    button.disabled = true;
    input.disabled = true;

    // Start generation with selected pipeline
    handleGeneration(query, logWidget, block, selectedPipeline).catch((error) => {
      console.error('Generation error:', error);
      // Re-enable form on error
      button.disabled = false;
      input.disabled = false;
    });
  });
}
