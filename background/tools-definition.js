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
  const interactionTools = ['click', 'type_text', 'press_key', 'hover', 'select_option', 'fill_form', 'execute_javascript', 'press_mapped_button'];
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
