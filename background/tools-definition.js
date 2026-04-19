// Tool definitions in OpenAI function calling format
// Used by both Ollama and OpenRouter

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'navigate',
      description: 'Navigate the browser tab to a specified URL',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to navigate to' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'click',
      description: 'Click on an element using a CSS selector. Sends a real trusted mouse click via the browser debugger protocol — works on all elements including contenteditable divs, React/Lexical editors, and shadow DOM. Use find_elements first to discover available elements.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the element to click' }
        },
        required: ['selector']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'type_text',
      description: 'Type text into any focusable element (input, textarea, contenteditable div, Lexical/Draft editors). Uses trusted keyboard input via the browser debugger — the element is clicked first to gain focus, then text is inserted via real key events.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the input element' },
          text: { type: 'string', description: 'Text to type into the element' },
          clearFirst: { type: 'boolean', description: 'Clear existing text before typing (default: true)' }
        },
        required: ['selector', 'text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'press_key',
      description: 'Press a keyboard key (e.g., Enter, Tab, Escape, ArrowDown). Sends a trusted key event via the browser debugger.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Key to press (e.g., Enter, Tab, Escape, Backspace, ArrowDown)' },
          selector: { type: 'string', description: 'Optional CSS selector of element to focus before pressing key' }
        },
        required: ['key']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'screenshot',
      description: 'Take a screenshot of the current visible page. Returns the image for visual analysis.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'extract_content',
      description: 'Extract the main content of the current page as clean, readable markdown. Filters out navigation, ads, and other non-content elements.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'extract_all_text',
      description: 'Extract ALL visible text from the page, including navigation, headers, footers, etc.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'find_elements',
      description: 'Find elements on the page matching a CSS selector. Returns tag, text, attributes, and position for each match. Use this to discover interactive elements before clicking or typing.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector to search for (e.g., "button", "a[href]", "input", ".classname")' },
          limit: { type: 'number', description: 'Maximum number of elements to return (default: 20)' }
        },
        required: ['selector']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'find_clickable',
      description: 'Find all clickable/interactive elements on the page (buttons, links, inputs). Returns a structured list with selectors you can use for click/type actions.',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string', description: 'Optional text filter to narrow down results' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'scroll',
      description: 'Scroll the page or a specific scrollable container. When the page has multiple independent scroll areas (sidebars, panels, columns, modals), pass a CSS selector for any element INSIDE the container you want to scroll — the tool will automatically find the nearest scrollable ancestor and scroll it. Without a selector it scrolls the main page.',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'], description: 'Direction to scroll' },
          amount: { type: 'number', description: 'Pixels to scroll for up/down (default: 500)' },
          selector: { type: 'string', description: 'Optional CSS selector of an element inside the scrollable container you want to scroll. The nearest scrollable ancestor will be used. Omit to scroll the main page.' }
        },
        required: ['direction']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'select_option',
      description: 'Select an option from a <select> dropdown element',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the select element' },
          value: { type: 'string', description: 'The value attribute of the option to select' }
        },
        required: ['selector', 'value']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fill_form',
      description: 'Fill multiple form fields at once',
      parameters: {
        type: 'object',
        properties: {
          fields: {
            type: 'array',
            description: 'Array of field objects with selector and value',
            items: {
              type: 'object',
              properties: {
                selector: { type: 'string', description: 'CSS selector of the field' },
                value: { type: 'string', description: 'Value to set' }
              },
              required: ['selector', 'value']
            }
          }
        },
        required: ['fields']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'wait',
      description: 'Wait for a specified number of seconds before continuing. Use this for timed delays, polling, or waiting for page loads.',
      parameters: {
        type: 'object',
        properties: {
          seconds: { type: 'number', description: 'Number of seconds to wait (max 300)' },
          reason: { type: 'string', description: 'Brief reason for waiting' }
        },
        required: ['seconds']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'wait_for_element',
      description: 'Wait for an element matching a CSS selector to appear on the page',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector to wait for' },
          timeout: { type: 'number', description: 'Maximum seconds to wait (default: 10)' }
        },
        required: ['selector']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_page_info',
      description: 'Get current page information: URL, title, meta description, and page dimensions',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'execute_javascript',
      description: 'Execute custom JavaScript code in the page context. Use with caution.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'JavaScript code to execute in the page' }
        },
        required: ['code']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'new_tab',
      description: 'Open a new browser tab, optionally with a URL',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to open in the new tab (optional)' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'close_tab',
      description: 'Close the current tab being controlled',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'switch_tab',
      description: 'Switch to a different open tab by index',
      parameters: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'Zero-based index of the tab to switch to' }
        },
        required: ['index']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_tabs',
      description: 'List all open browser tabs with their titles and URLs',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'execute_terminal',
      description: 'Execute a terminal/shell command on the local machine. Requires terminal permission to be granted.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          timeout: { type: 'number', description: 'Timeout in seconds (default: 30)' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'hover',
      description: 'Hover over an element to trigger hover effects or tooltips',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the element to hover over' }
        },
        required: ['selector']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'go_back',
      description: 'Navigate back in browser history',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'go_forward',
      description: 'Navigate forward in browser history',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'double_click',
      description: 'Double-click on an element or at specific coordinates. Use this to enter text-edit mode in canvas editors (Canva, Figma), open files, or trigger double-click handlers.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the element to double-click' },
          x: { type: 'number', description: 'X coordinate to double-click (use instead of selector for canvas elements)' },
          y: { type: 'number', description: 'Y coordinate to double-click (use instead of selector for canvas elements)' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'right_click',
      description: 'Right-click on an element or at coordinates to open its context menu.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the element to right-click' },
          x: { type: 'number', description: 'X coordinate to right-click' },
          y: { type: 'number', description: 'Y coordinate to right-click' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'drag',
      description: 'Click-and-drag from one position to another. Essential for canvas editors (Canva, Figma) to move objects, resize handles, drag items from a sidebar onto the canvas, or draw. Provide CSS selectors for known DOM elements, or raw x/y coordinates for canvas positions (use a screenshot first to get coordinates).',
      parameters: {
        type: 'object',
        properties: {
          from_selector: { type: 'string', description: 'CSS selector of the element to drag from' },
          to_selector: { type: 'string', description: 'CSS selector of the element to drag to' },
          from_x: { type: 'number', description: 'Starting X coordinate (use when selector unavailable)' },
          from_y: { type: 'number', description: 'Starting Y coordinate' },
          to_x: { type: 'number', description: 'Ending X coordinate' },
          to_y: { type: 'number', description: 'Ending Y coordinate' },
          steps: { type: 'integer', description: 'Number of intermediate mouse-move steps (default 20, increase for smoother drag on sensitive editors)' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'copy_image',
      description: 'Copy an image to the OS clipboard. Provide either a CSS selector pointing to an <img> element on the page, or a direct image URL. Once copied, use paste_image to paste it into any element that accepts image input (chat boxes, canvas editors, upload zones, etc.).',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of an <img> element whose image should be copied' },
          url: { type: 'string', description: 'Direct URL of the image to copy (used when no selector is given)' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'paste_image',
      description: 'Paste an image from the OS clipboard into a page element using a trusted Ctrl+V key event. Call copy_image first to load the image into the clipboard. Works on any element that accepts image paste: contenteditable divs, chat inputs, canvas editors (Canva, Figma), Google Docs, etc.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the element to focus before pasting. Omit to paste into whatever is currently focused.' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'map_buttons',
      description: 'Visually number every interactive button/link/input in the current viewport. Injects red numbered badges (1–30) onto the page, takes a screenshot showing the overlay, then removes the badges. Returns the screenshot AND a numbered button list. Use press_mapped_button to click a specific number. Prefer this over click when selectors are unclear or the page is complex.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'press_mapped_button',
      description: 'Click a button by its number from the most recent map_buttons call using a trusted debugger click. After clicking the button map is cleared — call map_buttons again to get fresh numbers.',
      parameters: {
        type: 'object',
        properties: {
          n: { type: 'integer', description: 'Button number to press (1-based, from the map_buttons list)' }
        },
        required: ['n']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'execute_steps',
      description: `Execute a multi-step plan in a single call. Groups steps into named sections and runs them sequentially. 
This is the PREFERRED tool when you know 2+ steps ahead. It reduces round-trips and is much faster than calling tools one at a time.
Each step is a tool call (navigate, click, type_text, press_key, wait, screenshot, etc.). 
Steps run in order within each section. On failure the plan stops and returns all results so far plus the error.
Auto-waits: 500ms after navigate, 100ms after click — no need for explicit wait steps in most cases.
PAGE MONITORING: Every action tool automatically captures before/after page state. If the URL, title, or notable DOM elements (modals, dialogs, alerts, forms, errors) change, a "pageChanges" object is included showing what appeared/disappeared.
VERIFICATION: Each step can include an optional "verify" object with assertions (url_contains, element_exists, element_absent, title_contains, text_contains, etc.). If verification fails, the plan stops with a clear error message.
Use this for common flows like: navigate → click → type → click, or search → screenshot → extract.`,
      parameters: {
        type: 'object',
        properties: {
          plan: {
            type: 'array',
            description: 'Array of sections, each with a title and steps',
            items: {
              type: 'object',
              properties: {
                section: { type: 'string', description: 'Human-readable section title (e.g. "Navigate to Twitter", "Compose Tweet")' },
                steps: {
                  type: 'array',
                  description: 'Steps to execute in this section',
                  items: {
                    type: 'object',
                    properties: {
                      tool: { type: 'string', description: 'Tool name to call (navigate, click, type_text, press_key, wait, screenshot, extract_content, find_elements, find_clickable, scroll, hover, wait_for_element, get_page_info, map_buttons, press_mapped_button, select_option, fill_form, execute_javascript, new_tab, go_back, go_forward, copy_image, paste_image, double_click, right_click, drag)' },
                      args: { type: 'object', description: 'Arguments for the tool (same as calling the tool directly)' },
                      verify: {
                        type: 'object',
                        description: 'Optional post-step assertions. If any check fails the plan stops with a clear error. Use to confirm page state after important actions.',
                        properties: {
                          url_contains: { type: 'string', description: 'URL must contain this substring after the step' },
                          url_not_contains: { type: 'string', description: 'URL must NOT contain this substring' },
                          title_contains: { type: 'string', description: 'Page title must contain this (case-insensitive)' },
                          element_exists: { type: 'string', description: 'CSS selector that must exist in DOM after the step' },
                          element_absent: { type: 'string', description: 'CSS selector that must NOT be visible after the step (e.g. a modal that should have closed)' },
                          text_contains: { type: 'string', description: 'Page body text must contain this string' },
                          text_absent: { type: 'string', description: 'Page body text must NOT contain this string' }
                        }
                      }
                    },
                    required: ['tool', 'args']
                  }
                }
              },
              required: ['section', 'steps']
            }
          }
        },
        required: ['plan']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'task_complete',
      description: 'Mark the current task as complete. Call this when you have finished the assigned task.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Summary of what was accomplished' }
        },
        required: ['summary']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'task_failed',
      description: 'Mark the current task as failed with a reason.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Why the task failed' }
        },
        required: ['reason']
      }
    }
  }
];

// Get tools filtered by permissions
export function getToolsForPermissions(permissions) {
  const terminalTools = ['execute_terminal'];
  const screenshotTools = ['screenshot'];
  const navigationTools = ['navigate', 'new_tab', 'close_tab', 'switch_tab', 'go_back', 'go_forward'];
  const interactionTools = ['click', 'type_text', 'press_key', 'hover', 'select_option', 'fill_form', 'execute_javascript', 'press_mapped_button', 'copy_image', 'paste_image', 'double_click', 'right_click', 'drag'];
  // map_buttons requires both screenshots AND interaction
  const visualMapTools = ['map_buttons'];

  return TOOLS.filter(tool => {
    const name = tool.function.name;
    if (terminalTools.includes(name) && !permissions.terminal) return false;
    if (screenshotTools.includes(name) && !permissions.screenshots) return false;
    if (navigationTools.includes(name) && !permissions.navigation) return false;
    if (interactionTools.includes(name) && !permissions.interaction) return false;
    if (visualMapTools.includes(name) && (!permissions.screenshots || !permissions.interaction)) return false;
    return true;
  });
}
