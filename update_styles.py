import os

file_path = 'h:\\schedule\\styles.css'

new_styles = """
.control-panel {
    background: white;
    padding: 1.5rem;
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-md);
    margin-bottom: 1.5rem;
    border: 1px solid rgba(102, 126, 234, 0.1);
    position: relative;
    overflow: hidden;
}

.control-panel::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 4px;
    background: var(--primary-gradient);
}

.control-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1.5rem;
    position: relative;
    z-index: 1;
}

.control-group {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: #f8fafc;
    padding: 0.5rem 1rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
    transition: var(--transition-fast);
}

.control-group:hover,
.control-group:focus-within {
    background: white;
    border-color: var(--primary-color);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
    transform: translateY(-1px);
}

.control-group label {
    font-weight: 600;
    color: var(--primary-dark);
    white-space: nowrap;
    font-size: 0.95rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
}

.date-input {
    padding: 0.6rem 1rem;
    border: 2px solid transparent;
    border-radius: var(--radius-sm);
    font-size: 1rem;
    font-family: inherit;
    color: var(--text-primary);
    background: white;
    transition: var(--transition-fast);
    min-width: 150px;
    font-weight: 500;
    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
}

.date-input:focus {
    outline: none;
    border-color: var(--primary-color);
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.2);
}

.date-separator {
    color: var(--primary-color);
    font-weight: 700;
    font-size: 1.2rem;
}

.room-select {
    padding: 0.6rem 2.5rem 0.6rem 1rem;
    border: 2px solid transparent;
    border-radius: var(--radius-sm);
    font-size: 1rem;
    font-family: inherit;
    color: var(--text-primary);
    background: white;
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23667eea' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 0.75rem center;
    transition: var(--transition-fast);
    font-weight: 500;
    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    min-width: 120px;
}

.room-select:focus {
    outline: none;
    border-color: var(--primary-color);
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.2);
}
"""

try:
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Define the start and end markers of the block to replace
    # We use a unique string from the start and end of the block
    start_marker = ".control-row {"
    end_marker = ".room-select:focus {"
    
    start_idx = content.find(start_marker)
    if start_idx == -1:
        print("Start marker not found")
        exit(1)
        
    # Find the end of the block starting at end_marker
    end_idx_start = content.find(end_marker, start_idx)
    if end_idx_start == -1:
        print("End marker not found")
        exit(1)
        
    # Find the closing brace of the end marker block
    end_idx = content.find("}", end_idx_start)
    if end_idx == -1:
        print("Closing brace not found")
        exit(1)
        
    end_idx += 1 # Include the closing brace

    # Perform replacement
    new_content = content[:start_idx] + new_styles + content[end_idx:]
    
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
        
    print("Successfully updated styles.css")

except Exception as e:
    print(f"Error: {e}")
