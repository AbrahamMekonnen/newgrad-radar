"""
Custom browser-use actions for job application form filling.

These bundled actions reduce LLM steps by combining common multi-step operations
into single, optimized actions. Based on BROWSER_USE_OPTIMIZATION.md.

Usage:
    from custom_actions import create_custom_tools

    tools = create_custom_tools()
    agent = Agent(
        task=task_prompt,
        llm=llm,
        browser=browser,
        tools=tools,
    )
"""

from typing import Optional
from pydantic import BaseModel, Field
from browser_use import Tools
from browser_use.agent.views import ActionResult


# --- Pydantic Models for Action Parameters ---

class FillByLabelParams(BaseModel):
    """Parameters for fill_by_label action"""
    label: str = Field(description="The label text of the field to fill (partial match supported)")
    value: str = Field(description="The value to enter into the field")


class UploadResumeParams(BaseModel):
    """Parameters for upload_resume action"""
    # No params needed - uses the resume from available_file_paths
    pass


class SelectDropdownParams(BaseModel):
    """Parameters for select_dropdown action (handles React Select, native, etc.)"""
    label: str = Field(description="The label text or placeholder of the dropdown")
    option: str = Field(description="The option text to select (partial match supported)")


class ClickNextPageParams(BaseModel):
    """Parameters for click_next_page action"""
    direction: str = Field(
        default="next",
        description="Navigation direction: 'next', 'continue', 'submit', or 'back'"
    )


class FillMultipleFieldsParams(BaseModel):
    """Parameters for fill_multiple_fields action - batch fill for efficiency"""
    fields: str = Field(
        description="JSON string of field mappings, e.g. '{\"First Name\": \"John\", \"Email\": \"john@example.com\"}'"
    )


# --- JavaScript Helpers ---

JS_FIND_FIELD_BY_LABEL = '''
(function(labelText) {
    const normalizedLabel = labelText.toLowerCase().trim();

    // Strategy 1: Find <label> element with matching text
    const labels = document.querySelectorAll('label');
    for (const label of labels) {
        const text = label.textContent.toLowerCase().trim();
        if (text.includes(normalizedLabel)) {
            const forId = label.getAttribute('for');
            let input = forId ? document.getElementById(forId) : null;
            if (!input) {
                // Look for input inside or adjacent to label
                input = label.querySelector('input, textarea, select');
            }
            if (!input) {
                input = label.parentElement?.querySelector('input, textarea, select');
            }
            if (!input) {
                input = label.closest('.field, .form-group, .form-field')?.querySelector('input, textarea, select');
            }
            if (input) return { element: input, label: label.textContent.trim() };
        }
    }

    // Strategy 2: Find by placeholder
    const inputs = document.querySelectorAll('input, textarea');
    for (const input of inputs) {
        const placeholder = (input.getAttribute('placeholder') || '').toLowerCase();
        if (placeholder.includes(normalizedLabel)) {
            return { element: input, label: placeholder };
        }
    }

    // Strategy 3: Find by aria-label
    for (const input of inputs) {
        const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
        if (ariaLabel.includes(normalizedLabel)) {
            return { element: input, label: ariaLabel };
        }
    }

    // Strategy 4: Find by name attribute
    for (const input of inputs) {
        const name = (input.getAttribute('name') || '').toLowerCase().replace(/[_-]/g, ' ');
        if (name.includes(normalizedLabel)) {
            return { element: input, label: name };
        }
    }

    return null;
})
'''

JS_FILL_INPUT = '''
(function(element, value) {
    // Focus and clear
    element.focus();
    element.select && element.select();

    // Set value
    element.value = value;

    // Dispatch events to trigger React/Vue/Angular handlers
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

    // Blur to trigger validation
    element.blur();
    element.dispatchEvent(new Event('blur', { bubbles: true }));

    return true;
})
'''

JS_FIND_FILE_INPUT = '''
(function() {
    const inputs = document.querySelectorAll('input[type="file"]');

    // Priority 1: Input that accepts PDFs or has resume/CV in name
    for (const input of inputs) {
        const accept = (input.getAttribute('accept') || '').toLowerCase();
        const name = (input.getAttribute('name') || '').toLowerCase();
        const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
        const id = (input.getAttribute('id') || '').toLowerCase();
        const combined = name + ' ' + ariaLabel + ' ' + id;

        if (accept.includes('pdf') || accept.includes('doc') ||
            combined.includes('resume') || combined.includes('cv') ||
            combined.includes('attachment')) {
            return { found: true, index: Array.from(inputs).indexOf(input) };
        }
    }

    // Priority 2: First file input on the page
    if (inputs.length > 0) {
        return { found: true, index: 0, fallback: true };
    }

    return { found: false };
})()
'''

JS_HANDLE_REACT_SELECT = '''
(function(labelText, optionText) {
    const normalizedLabel = labelText.toLowerCase().trim();
    const normalizedOption = optionText.toLowerCase().trim();

    // Find the React Select container
    let container = null;

    // Strategy 1: Find by associated label
    const labels = document.querySelectorAll('label');
    for (const label of labels) {
        if (label.textContent.toLowerCase().includes(normalizedLabel)) {
            // Look for react-select in nearby elements
            const parent = label.closest('.field, .form-group, .form-field, [class*="field"]');
            if (parent) {
                container = parent.querySelector('[class*="select"], [class*="Select"], [class*="dropdown"]');
            }
            if (!container) {
                container = label.parentElement?.querySelector('[class*="select"], [class*="Select"]');
            }
            if (container) break;
        }
    }

    // Strategy 2: Find by placeholder
    if (!container) {
        const placeholders = document.querySelectorAll('[class*="placeholder"], [class*="single-value"]');
        for (const el of placeholders) {
            if (el.textContent.toLowerCase().includes(normalizedLabel)) {
                container = el.closest('[class*="select"], [class*="Select"]');
                if (container) break;
            }
        }
    }

    if (!container) {
        return { success: false, error: 'Could not find dropdown container' };
    }

    // Click to open dropdown
    const control = container.querySelector('[class*="control"]') || container;
    control.click();

    // Wait for menu and find option
    return new Promise((resolve) => {
        setTimeout(() => {
            const options = document.querySelectorAll('[class*="option"], [role="option"], [class*="menu"] div');
            for (const option of options) {
                if (option.textContent.toLowerCase().includes(normalizedOption)) {
                    option.click();
                    resolve({ success: true, selected: option.textContent.trim() });
                    return;
                }
            }
            resolve({ success: false, error: 'Option not found: ' + optionText });
        }, 100);
    });
})
'''

JS_HANDLE_NATIVE_SELECT = '''
(function(selectElement, optionText) {
    const normalizedOption = optionText.toLowerCase().trim();

    // Find matching option
    for (const option of selectElement.options) {
        if (option.text.toLowerCase().includes(normalizedOption) ||
            option.value.toLowerCase().includes(normalizedOption)) {
            selectElement.value = option.value;
            selectElement.dispatchEvent(new Event('change', { bubbles: true }));
            return { success: true, selected: option.text };
        }
    }

    return { success: false, error: 'Option not found' };
})
'''

JS_FIND_NAVIGATION_BUTTON = '''
(function(direction) {
    const normalizedDir = direction.toLowerCase();

    // Define patterns for each direction
    const patterns = {
        'next': ['next', 'continue', 'proceed', 'forward', '>', 'step'],
        'continue': ['continue', 'next', 'proceed', 'go'],
        'submit': ['submit', 'apply', 'send', 'finish', 'complete', 'done'],
        'back': ['back', 'previous', 'prev', '<', 'return']
    };

    const searchTerms = patterns[normalizedDir] || [normalizedDir];

    // Find buttons and links
    const clickables = document.querySelectorAll('button, input[type="submit"], input[type="button"], a[class*="btn"], [role="button"]');

    // Score each element
    let bestMatch = null;
    let bestScore = 0;

    for (const el of clickables) {
        // Skip hidden elements
        if (el.offsetParent === null && !el.closest('[class*="modal"]')) continue;
        if (el.disabled) continue;

        const text = (el.textContent || el.value || '').toLowerCase().trim();
        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
        const className = (el.className || '').toLowerCase();

        let score = 0;
        for (const term of searchTerms) {
            if (text.includes(term)) score += 3;
            if (ariaLabel.includes(term)) score += 2;
            if (className.includes(term)) score += 1;
        }

        // Prefer primary/prominent buttons
        if (className.includes('primary') || className.includes('main')) score += 1;
        if (el.type === 'submit') score += 1;

        if (score > bestScore) {
            bestScore = score;
            bestMatch = el;
        }
    }

    if (bestMatch) {
        return { found: true, text: bestMatch.textContent?.trim() || bestMatch.value };
    }

    return { found: false };
})
'''


def create_custom_tools() -> Tools:
    """
    Create and return a Tools instance with all custom actions registered.

    Returns:
        Tools: browser-use Tools instance with custom actions for form filling.
    """
    tools = Tools()

    # --- Action 1: fill_by_label ---
    @tools.action(
        "Fill a form field by finding its label text (supports partial matching)",
        param_model=FillByLabelParams
    )
    async def fill_by_label(params: FillByLabelParams, browser_session) -> ActionResult:
        """
        Find a form field by its label text and fill it with a value.
        Uses multiple strategies: label for=id, label containing input,
        placeholder, aria-label, and name attribute.
        """
        js_code = f'''
        (async function() {{
            const findField = {JS_FIND_FIELD_BY_LABEL};
            const fillInput = {JS_FILL_INPUT};

            const result = findField("{params.label.replace('"', '\\"')}");
            if (!result) {{
                return {{ success: false, error: "Field not found: {params.label}" }};
            }}

            fillInput(result.element, "{params.value.replace('"', '\\"')}");
            return {{ success: true, field: result.label, value: "{params.value[:50]}..." }};
        }})()
        '''

        try:
            page = await browser_session.get_current_page()
            result = await page.evaluate(js_code)

            if result.get('success'):
                return ActionResult(
                    extracted_content=f"Filled '{result.get('field')}' with value",
                    long_term_memory=f"Filled {params.label} field"
                )
            else:
                return ActionResult(
                    error=f"Could not find field: {params.label}. Error: {result.get('error', 'unknown')}"
                )
        except Exception as e:
            return ActionResult(error=f"fill_by_label failed: {str(e)}")

    # --- Action 2: upload_resume ---
    @tools.action(
        "Upload the candidate's resume to a file input field",
        param_model=UploadResumeParams
    )
    async def upload_resume(
        params: UploadResumeParams,
        browser_session,
        available_file_paths: list[str] = None
    ) -> ActionResult:
        """
        Find the resume/file upload input and upload the resume file.
        Automatically detects the correct file input on the page.
        """
        if not available_file_paths:
            return ActionResult(error="No file paths available. Resume path not configured.")

        # Find resume file (first PDF or file with 'resume' in name)
        resume_path = None
        for path in available_file_paths:
            path_lower = path.lower()
            if 'resume' in path_lower or path_lower.endswith('.pdf'):
                resume_path = path
                break

        if not resume_path:
            resume_path = available_file_paths[0]  # Fallback to first file

        try:
            page = await browser_session.get_current_page()

            # Find the file input
            result = await page.evaluate(JS_FIND_FILE_INPUT)

            if not result.get('found'):
                return ActionResult(error="No file upload input found on the page")

            # Get the file input element
            file_inputs = await page.query_selector_all('input[type="file"]')
            if not file_inputs or result.get('index', 0) >= len(file_inputs):
                return ActionResult(error="File input element not accessible")

            file_input = file_inputs[result.get('index', 0)]

            # Upload the file
            await file_input.set_input_files(resume_path)

            msg = "Resume uploaded successfully"
            if result.get('fallback'):
                msg += " (used first file input)"

            return ActionResult(
                extracted_content=msg,
                long_term_memory=f"Uploaded resume from {resume_path}"
            )
        except Exception as e:
            return ActionResult(error=f"Resume upload failed: {str(e)}")

    # --- Action 3: select_dropdown ---
    @tools.action(
        "Select an option from a dropdown (handles React Select, native select, and custom dropdowns)",
        param_model=SelectDropdownParams
    )
    async def select_dropdown(params: SelectDropdownParams, browser_session) -> ActionResult:
        """
        Select an option from various dropdown implementations.
        Handles: React Select, native <select>, and custom dropdown components.
        """
        try:
            page = await browser_session.get_current_page()

            # First, try to find a native <select> element
            find_native_js = f'''
            (function() {{
                const findField = {JS_FIND_FIELD_BY_LABEL};
                const result = findField("{params.label.replace('"', '\\"')}");
                if (result && result.element.tagName === 'SELECT') {{
                    return {{ type: 'native', found: true }};
                }}
                return {{ type: 'none', found: false }};
            }})()
            '''

            native_check = await page.evaluate(find_native_js)

            if native_check.get('type') == 'native':
                # Handle native select
                handle_native_js = f'''
                (function() {{
                    const findField = {JS_FIND_FIELD_BY_LABEL};
                    const handleSelect = {JS_HANDLE_NATIVE_SELECT};

                    const result = findField("{params.label.replace('"', '\\"')}");
                    if (result && result.element.tagName === 'SELECT') {{
                        return handleSelect(result.element, "{params.option.replace('"', '\\"')}");
                    }}
                    return {{ success: false, error: 'Select element not found' }};
                }})()
                '''
                result = await page.evaluate(handle_native_js)
            else:
                # Handle React Select or custom dropdown
                handle_react_js = f'''
                (async function() {{
                    const handleReactSelect = {JS_HANDLE_REACT_SELECT};
                    return await handleReactSelect(
                        "{params.label.replace('"', '\\"')}",
                        "{params.option.replace('"', '\\"')}"
                    );
                }})()
                '''
                result = await page.evaluate(handle_react_js)

            if result.get('success'):
                return ActionResult(
                    extracted_content=f"Selected '{result.get('selected')}' in dropdown",
                    long_term_memory=f"Selected {params.option} from {params.label} dropdown"
                )
            else:
                return ActionResult(
                    error=f"Could not select option: {result.get('error', 'unknown')}"
                )
        except Exception as e:
            return ActionResult(error=f"select_dropdown failed: {str(e)}")

    # --- Action 4: click_next_page ---
    @tools.action(
        "Click the next/continue/submit button to navigate between form pages",
        param_model=ClickNextPageParams
    )
    async def click_next_page(params: ClickNextPageParams, browser_session) -> ActionResult:
        """
        Find and click navigation buttons (next, continue, submit, back).
        Uses intelligent matching to find the correct button on multi-page forms.
        """
        try:
            page = await browser_session.get_current_page()

            # Find the button
            find_button_js = f'''
            (function() {{
                const findButton = {JS_FIND_NAVIGATION_BUTTON};
                return findButton("{params.direction.replace('"', '\\"')}");
            }})()
            '''

            result = await page.evaluate(find_button_js)

            if not result.get('found'):
                return ActionResult(
                    error=f"No '{params.direction}' button found on page"
                )

            # Click the button
            click_js = f'''
            (function() {{
                const findButton = {JS_FIND_NAVIGATION_BUTTON};
                const buttonInfo = findButton("{params.direction.replace('"', '\\"')}");
                if (!buttonInfo.found) return {{ success: false }};

                // Re-query and click
                const clickables = document.querySelectorAll('button, input[type="submit"], input[type="button"], a[class*="btn"], [role="button"]');
                for (const el of clickables) {{
                    const text = (el.textContent || el.value || '').toLowerCase().trim();
                    if (text.includes(buttonInfo.text.toLowerCase().trim().substring(0, 10))) {{
                        el.click();
                        return {{ success: true, clicked: buttonInfo.text }};
                    }}
                }}
                return {{ success: false }};
            }})()
            '''

            click_result = await page.evaluate(click_js)

            if click_result.get('success'):
                # Wait for navigation/page change
                await page.wait_for_timeout(500)

                return ActionResult(
                    extracted_content=f"Clicked '{click_result.get('clicked')}' button",
                    long_term_memory=f"Navigated {params.direction} in form"
                )
            else:
                return ActionResult(
                    error=f"Found but could not click '{params.direction}' button"
                )
        except Exception as e:
            return ActionResult(error=f"click_next_page failed: {str(e)}")

    # --- Action 5: fill_multiple_fields (bonus batch action) ---
    @tools.action(
        "Fill multiple form fields at once (batch operation for efficiency)",
        param_model=FillMultipleFieldsParams
    )
    async def fill_multiple_fields(
        params: FillMultipleFieldsParams,
        browser_session
    ) -> ActionResult:
        """
        Fill multiple fields in a single action to reduce LLM steps.
        Accepts a JSON string mapping labels to values.
        """
        import json

        try:
            field_map = json.loads(params.fields)
        except json.JSONDecodeError as e:
            return ActionResult(error=f"Invalid JSON in fields parameter: {str(e)}")

        if not isinstance(field_map, dict):
            return ActionResult(error="fields must be a JSON object mapping labels to values")

        try:
            page = await browser_session.get_current_page()

            # Build JS to fill all fields
            filled = []
            errors = []

            for label, value in field_map.items():
                js_code = f'''
                (function() {{
                    const findField = {JS_FIND_FIELD_BY_LABEL};
                    const fillInput = {JS_FILL_INPUT};

                    const result = findField("{label.replace('"', '\\"')}");
                    if (!result) {{
                        return {{ success: false, label: "{label}", error: "not found" }};
                    }}

                    fillInput(result.element, "{str(value).replace('"', '\\"')}");
                    return {{ success: true, label: result.label }};
                }})()
                '''

                result = await page.evaluate(js_code)

                if result.get('success'):
                    filled.append(result.get('label'))
                else:
                    errors.append(f"{label}: {result.get('error', 'unknown')}")

            if filled:
                msg = f"Filled {len(filled)} fields: {', '.join(filled)}"
                if errors:
                    msg += f". Errors: {'; '.join(errors)}"
                return ActionResult(
                    extracted_content=msg,
                    long_term_memory=f"Batch filled {len(filled)} fields"
                )
            else:
                return ActionResult(error=f"No fields were filled. Errors: {'; '.join(errors)}")

        except Exception as e:
            return ActionResult(error=f"fill_multiple_fields failed: {str(e)}")

    return tools


# --- Convenience function for agent.py integration ---

def get_custom_tools_for_agent() -> Tools:
    """
    Get configured custom tools ready for use with browser-use Agent.

    Example usage in agent.py:
        from custom_actions import get_custom_tools_for_agent

        agent = Agent(
            task=task_prompt,
            llm=llm,
            browser=browser,
            tools=get_custom_tools_for_agent(),
        )
    """
    return create_custom_tools()


# --- Export ---
__all__ = ['create_custom_tools', 'get_custom_tools_for_agent']
