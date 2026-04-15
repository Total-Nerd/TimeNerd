// renderer.js
/**
 * This script manages all the front-end logic for the TimeNerd application,
 * including data handling, UI rendering, event listeners, and feature logic.
 * It uses jQuery for DOM manipulation and Lodash for utility functions.
 */

$(() => {

    // --- 1. SETUP & INITIALIZATION ---
    // This section defines constants, caches jQuery element selectors for performance,
    // and holds the global state of the application.

    // --- Constants ---
    const IDLE_TIMEOUT_MINUTES = 5;

    // --- Element Declarations (jQuery style) ---
    // Caching selectors prevents repeated DOM queries, improving performance.
    const $projectListContainer = $('#project-list-container');
    const $searchInput = $('#search-input');
    const $clearSearchBtn = $('#clear-search-btn');
    const $globalTimerBar = $('#global-timer-bar');
    const $projectModal = $('#project-modal');
    const $editTaskModal = $('#edit-task-modal');
    const $idleModal = $('#idle-modal');
    const $logModal = $('#log-modal');
    const $confirmModal = $('#confirm-modal');
    const $googleSheetModal = $('#google-sheet-modal');
    const $settingsModal = $('#settings-modal');
    const $addTaskModal = $('#add-task-modal');
    const $colorSwatchesContainer = $('.color-swatches');
    const $notesView = $('#notes-view');

    // --- Global State ---
    // These variables hold the application's data and UI state.
    let projects = []; // The main array holding all project and task data.
    let timers = {}; // An object to store active setInterval IDs for running tasks.
    let allowConcurrentTimers = localStorage.getItem('allow_concurrent_timers') === 'true';
    let includeNotesInExport = localStorage.getItem('include_notes_in_export') === 'true';
    let runningTasks = []; // A cache of all currently running tasks for the global timer bar.
    let globalTimerIndex = 0; // The index of the currently displayed task in the global timer bar.
    let actionToConfirm = null; // A function to be executed when a confirmation modal is approved.
    let currentTheme = localStorage.getItem('theme_preference') || 'system';
    let idleInfo = { timer: null, detectedAt: null, activeTaskInfo: null };
    let currentFilter = ''; // The current value of the search input.
    let quill; // To hold the Quill editor instance
    let activeNotesTaskId = null; // To track which task's notes are being viewed

    // --- Color Palettes ---
    // Defines the CSS variables for each available accent color theme.
    const colorPalettes = {
        yellow: { name: 'Yellow', colors: { '--accent-primary': '#f59e0b', '--accent-primary-hover': '#d97706', '--accent-secondary': '#fbbf24', '--text-on-accent': '#1f2937', '--border-accent-focus': '#f59e0b', '--tag-bg': '#fef3c7', '--tag-text': '#92400e', '--dark-tag-bg': '#78350f', '--dark-tag-text': '#fde68a' }},
        indigo: { name: 'Indigo', colors: { '--accent-primary': '#4f46e5', '--accent-primary-hover': '#4338ca', '--accent-secondary': '#6366f1', '--text-on-accent': '#ffffff', '--border-accent-focus': '#4f46e5', '--tag-bg': '#e0e7ff', '--tag-text': '#3730a3', '--dark-tag-bg': '#3730a3', '--dark-tag-text': '#c7d2fe' }},
        green:  { name: 'Green',  colors: { '--accent-primary': '#16a34a', '--accent-primary-hover': '#15803d', '--accent-secondary': '#22c55e', '--text-on-accent': '#ffffff', '--border-accent-focus': '#16a34a', '--tag-bg': '#dcfce7', '--tag-text': '#14532d', '--dark-tag-bg': '#14532d', '--dark-tag-text': '#bbf7d0' }},
        blue:   { name: 'Blue',   colors: { '--accent-primary': '#2563eb', '--accent-primary-hover': '#1d4ed8', '--accent-secondary': '#3b82f6', '--text-on-accent': '#ffffff', '--border-accent-focus': '#2563eb', '--tag-bg': '#dbeafe', '--tag-text': '#1e3a8a', '--dark-tag-bg': '#1e3a8a', '--dark-tag-text': '#bfdbfe' }},
        red:    { name: 'Red',    colors: { '--accent-primary': '#dc2626', '--accent-primary-hover': '#b91c1c', '--accent-secondary': '#ef4444', '--text-on-accent': '#ffffff', '--border-accent-focus': '#dc2626', '--tag-bg': '#fee2e2', '--tag-text': '#7f1d1d', '--dark-tag-bg': '#7f1d1d', '--dark-tag-text': '#fecaca' }},
        pink:   { name: 'Pink',   colors: { '--accent-primary': '#db2777', '--accent-primary-hover': '#be185d', '--accent-secondary': '#ec4899', '--text-on-accent': '#ffffff', '--border-accent-focus': '#db2777', '--tag-bg': '#fce7f3', '--tag-text': '#831843', '--dark-tag-bg': '#831843', '--dark-tag-text': '#fbcfe8' }},
        orange: { name: 'Orange', colors: { '--accent-primary': '#f97316', '--accent-primary-hover': '#ea580c', '--accent-secondary': '#fb923c', '--text-on-accent': '#ffffff', '--border-accent-focus': '#f97316', '--tag-bg': '#ffedd5', '--tag-text': '#7c2d12', '--dark-tag-bg': '#7c2d12', '--dark-tag-text': '#fed7aa' }},
    };

    /**
     * Initializes the application on startup.
     */
    async function initialize() {
        const savedAccent = localStorage.getItem('accent_color') || 'yellow';
        applyAccentColor(savedAccent);
        setupTheme();
        await loadData();
        setupEventListeners();
        setupSettingsModal();
        updateGlobalTimerUI();
        feather.replace();
    }


    // --- 2. DATA HANDLING ---
    // Functions for loading from and saving to the main process via the preload script.

    /**
     * Loads project data from the main process and restarts any running timers.
     */
    async function loadData() {
        projects = await window.electronAPI.getData();
        render(); // Initial render of the UI.

        // Find any tasks that were running when the app was closed and restart their timers.
        _.forEach(projects, p => {
            _.forEach(p.tasks, t => {
                if (t.isRunning) {
                    startTimerInterval(p.id, t);
                    startIdleDetection();
                }
            });
        });
    }

    /**
     * Saves the current `projects` array to the main process.
     */
    function saveData() {
        window.electronAPI.setData(projects);
    }


    // --- 3. RENDER LOGIC ---
    // Functions responsible for building and updating the DOM.

    /**
     * The main render function. It clears and rebuilds the project list.
     */
    function render() {
        // Persist the expanded/collapsed state of projects across renders.
        const expandedProjects = new Set();
        $('.project-header.expanded').each((i, header) => {
            expandedProjects.add(parseInt($(header).closest('[data-project-id]').data('projectId')));
        });

        const filteredProjects = getFilteredProjects();
        const nonArchivedProjects = filteredProjects.filter(p => !p.isArchived);
        const $activeProjectList = $('#active-project-list').empty();

        $projectListContainer.find('.completed-divider, .project-card.completed, .empty-state').remove();

        // Display the appropriate empty state message if needed.
        if (_.isEmpty(nonArchivedProjects) && !_.isEmpty(projects.filter(p=>!p.isArchived))) {
            $projectListContainer.append(`<div class="empty-state"><h3>No items match your search.</h3><p>Try a different search term or clear the search.</p></div>`);
        } else if (_.isEmpty(projects.filter(p=>!p.isArchived))) {
            $projectListContainer.append(`<div class="empty-state"><h3>No projects yet.</h3><p>Add a new project to get started!</p></div>`);
        } else {
            // Separate projects into active and completed lists.
            const [activeProjects, completedProjects] = _.partition(nonArchivedProjects, p => !p.isComplete);

            _.forEach(activeProjects, project => {
                const isExpanded = expandedProjects.has(project.id) || _.some(project.tasks, 'isRunning');
                $activeProjectList.append(createProjectElement(project, isExpanded));
            });

            // Completed projects are appended outside the sortable container
            if (!_.isEmpty(completedProjects)) {
                $projectListContainer.append(`<div class="completed-divider"><h3>Completed Projects</h3></div>`);
                _.forEach(completedProjects, project => {
                    const isExpanded = false;
                    $projectListContainer.append(createProjectElement(project, isExpanded));
                });
            }
        }
        updateDatalists();
        feather.replace(); // Re-initialize icons after DOM changes.
        setupDragAndDrop();
    }

    /**
     * Creates the HTML string for a single project card.
     * @param {object} project - The project object.
     * @param {boolean} isExpanded - Whether the project's task list should be visible.
     * @returns {string} The HTML string for the project card.
     */
    function createProjectElement(project, isExpanded = false) {
        const totalMs = _.sumBy(project.tasks, 'totalTime');
        const customerHTML = project.customer ? `<p class="project-customer">${_.escape(project.customer)}</p>` : '';
        
        let budgetHTML = '';
        if (project.budget > 0) {
            const totalHours = totalMs / 3600000;
            const percentage = Math.min((totalHours / project.budget) * 100, 100);
            const isOverBudget = totalHours > project.budget;
            budgetHTML = `
                <div class="project-budget-info">
                    <span>${totalHours.toFixed(1)}h / ${project.budget}h</span>
                    <span>${Math.round(percentage)}%</span>
                </div>
                <div class="progress-bar-container">
                    <div class="progress-bar ${isOverBudget ? 'over-budget' : ''}" style="width: ${percentage}%"></div>
                </div>`;
        }
        
        let projectControlsHTML = '';
        if (project.isComplete) {
            projectControlsHTML = `
                <div class="project-controls">
                    <div class="menu-container">
                        <button class="menu-btn" data-type="project"><i data-feather="more-vertical"></i></button>
                        <div class="menu-dropdown hidden">
                            <a href="#" class="menu-item" data-action="complete">Re-open Project</a>
                            <a href="#" class="menu-item" data-action="archive">Archive Project</a>
                            <a href="#" class="menu-item danger" data-action="delete">Delete</a>
                        </div>
                    </div>
                    <i data-feather="chevron-down" class="chevron ${isExpanded ? 'rotate' : ''}"></i>
                </div>`;
        } else {
            projectControlsHTML = `
                <div class="project-controls">
                    <button class="add-task-btn" title="Add New Task"><i data-feather="plus-circle"></i></button>
                    <div class="menu-container">
                        <button class="menu-btn" data-type="project"><i data-feather="more-vertical"></i></button>
                        <div class="menu-dropdown hidden">
                            <a href="#" class="menu-item" data-action="edit">Edit</a>
                            <a href="#" class="menu-item" data-action="export">Export CSV</a>
                            <a href="#" class="menu-item" data-action="complete">Project Complete</a>
                            <a href="#" class="menu-item" data-action="complete-and-archive">Complete & Archive</a>
                            <a href="#" class="menu-item danger" data-action="delete">Delete</a>
                        </div>
                    </div>
                    <i data-feather="chevron-down" class="chevron ${isExpanded ? 'rotate' : ''}"></i>
                </div>`;
        }
        
        const tasksHTML = !_.isEmpty(project.tasks) ? _.map(project.tasks, createTaskElement).join('') : '<p class="no-tasks">No tasks in this project yet.</p>';

        return `
            <div class="project-card ${project.isComplete ? 'completed' : ''}" data-project-id="${project.id}">
                <div class="project-header ${isExpanded ? 'expanded' : ''}">
                    <div class="project-info">
                        <h3>${_.escape(project.name)}</h3>
                        ${customerHTML}
                        <p id="project-total-${project.id}">Total Time: ${formatTime(totalMs)}</p>
                        ${budgetHTML}
                    </div>
                    ${projectControlsHTML}
                </div>
                <div class="task-list-container ${isExpanded ? '' : 'hidden'}">${tasksHTML}</div>
            </div>`;
    }
    
    /**
     * Creates the HTML string for a single task item.
     * @param {object} task - The task object.
     * @returns {string} The HTML string for the task item.
     */
    function createTaskElement(task) {
        const tagsHTML = _.map(task.tags, tag => `<span class="tag" data-tag="${_.escape(tag)}">${_.escape(tag)}</span>`).join('');
        return `
            <div class="task-item" data-task-id="${task.id}">
                <div class="task-details">
                    <h4>${_.escape(task.name)}</h4>
                    <div class="tags">${tagsHTML}</div>
                </div>
                <div class="task-controls">
                    <div class="timer" id="timer-${task.id}">${formatTime(task.totalTime)}</div>
                    <div class="buttons">
                        <button class="start-stop-btn ${task.isRunning ? 'stop' : 'start'}">${task.isRunning ? 'Stop' : 'Start'}</button>
                        <button class="view-log-btn">Logs</button>
                        <button class="notes-btn">Notes</button>
                        <div class="menu-container">
                            <button class="menu-btn" data-type="task"><i data-feather="more-vertical"></i></button>
                            <div class="menu-dropdown hidden">
                                <a href="#" class="menu-item" data-action="edit">Edit</a>
                                <a href="#" class="menu-item danger" data-action="delete">Delete</a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
    }
    
    /**
     * Updates the datalists for customer and tag input suggestions.
     */
    function updateDatalists() {
        const allCustomers = _.chain(projects).map('customer').filter().uniq().value();
        const allTags = _.chain(projects).flatMap('tasks').flatMap('tags').uniq().value();
        $('#customer-list').html(_.map(allCustomers, c => `<option value="${_.escape(c)}"></option>`).join(''));
        $('#tag-list').html(_.map(allTags, t => `<option value="${_.escape(t)}"></option>`).join(''));
    }

    /**
     * Initializes SortableJS for drag-and-drop on active projects and tasks.
     */
    function setupDragAndDrop() {
        const activeProjectList = document.getElementById('active-project-list');

        if (activeProjectList) {
            new Sortable(activeProjectList, {
                animation: 150,
                ghostClass: 'sortable-ghost',
                handle: '.project-header',
                onEnd: (evt) => {
                    const activeProjects = projects.filter(p => p && !p.isComplete);
                    const completedProjects = projects.filter(p => p && p.isComplete);

                    const [movedProject] = activeProjects.splice(evt.oldIndex, 1);
                    activeProjects.splice(evt.newIndex, 0, movedProject);

                    projects = [...activeProjects, ...completedProjects];
                    saveData();
                }
            });
        }

        document.querySelectorAll('.task-list-container').forEach(taskList => {
            const projectId = parseInt(taskList.closest('.project-card').dataset.projectId);
            new Sortable(taskList, {
                animation: 150,
                ghostClass: 'sortable-ghost',
                onEnd: (evt) => {
                    const project = _.find(projects, { id: projectId });
                    if (project) {
                        const movedTask = project.tasks.splice(evt.oldIndex, 1)[0];
                        project.tasks.splice(evt.newIndex, 0, movedTask);
                        saveData();
                    }
                }
            });
        });
    }

    // --- 4. EVENT LISTENERS & HANDLERS ---
    // This section registers all event listeners and defines their handler functions.

    /**
     * Sets up all the application's event listeners.
     */
    function setupEventListeners() {
        // Main controls
        $('#add-project-btn').on('click', openAddProjectModal);
        $('#project-form').on('submit', handleSaveProject);
        $('#cancel-project-form').on('click', closeProjectModal);
        $('#edit-task-form').on('submit', handleSaveTaskEdit);
        $('#cancel-edit-task').on('click', closeEditTaskModal);

        $projectListContainer.on('click', handleProjectListClick);
        $('#settings-btn').on('click', () => $('#settings-dropdown').toggleClass('hidden'));
        $('#export-btn').on('click', handleExport);
        $('#import-btn').on('click', handleImport);
        $('#google-sheet-modal-btn').on('click', openGoogleSheetModal);
        $('#concurrent-tasks-toggle').on('change', handleConcurrentToggle);
        $('#include-notes-toggle').on('change', handleIncludeNotesToggle);
        $('#link-sheet-btn').on('click', handleLinkSheet);
        $('#cancel-sheet-link').on('click', closeGoogleSheetModal);
        $('#close-modal').on('click', () => $logModal.addClass('hidden'));
        $('#confirm-delete').on('click', handleConfirm);
        $('#cancel-delete').on('click', closeConfirmModal);
        $('#add-task-modal-form').on('submit', handleAddTaskFromModal);
        $('#cancel-add-task').on('click', closeAddTaskModal);
        
        $searchInput.on('input', _.debounce(handleSearch, 200));
        $clearSearchBtn.on('click', clearSearch);
        
        $(window).on('keydown', handleKeyboardShortcuts);
        $('#idle-keep-btn').on('click', handleIdleKeep);
        $('#idle-discard-btn').on('click', handleIdleDiscard);

        // New listeners for Notes and Archive
        $('#close-notes-view').on('click', closeNotesView);
        $('#add-note-btn').on('click', handleAddNote);
        $('#archived-projects-btn').on('click', showArchivedProjects);

        // Global timer bar controls
        $('#global-timer-stop-btn').on('click', handleGlobalStop);
        $('#global-timer-prev').on('click', cycleGlobalTimer(-1));
        $('#global-timer-next').on('click', cycleGlobalTimer(1));
        
        $(window).on('click', closeMenusOnClickOutside);
        $(window).on('online offline', handleOnlineStatusChange);
        handleOnlineStatusChange();
        setupNotesListener();

        $('#close-archive-modal').on('click', () => $('#archive-modal').addClass('hidden'));

        // Use event delegation for buttons inside the archive modal
        $('#archive-modal-body').on('click', '.unarchive-btn', function() {
            const projectId = parseInt($(this).closest('.archived-item').data('projectId'));
            unarchiveProject(projectId);
        });

        $('#archive-modal-body').on('click', '.delete-btn', function() {
            const projectId = parseInt($(this).closest('.archived-item').data('projectId'));
            // We can reuse the existing confirmation modal for deletion
            openConfirmModal({ type: 'project', projectId });
            // Close the archive modal after initiating delete
            $('#archive-modal').addClass('hidden');
        });
    }
    
    function handleProjectListClick(e) {
        const $target = $(e.target);
        const $projectHeader = $target.closest('.project-header');
        const $button = $target.closest('button');
        const $menuItem = $target.closest('.menu-item');
        const $tag = $target.closest('.tag');

        // Convert data attributes to numbers immediately to prevent type issues.
        const projectId = parseInt($target.closest('[data-project-id]')?.data('projectId'));
        const taskId = parseInt($target.closest('[data-task-id]')?.data('taskId'));

        if ($tag.length) {
            $searchInput.val($tag.data('tag'));
            handleSearch();
        } else if ($button.hasClass('add-task-btn')) {
            openAddTaskModal(projectId);
        } else if ($projectHeader.length && !$button.length && !$menuItem.length) {
            toggleProjectExpansion($projectHeader);
        } else if ($button.hasClass('menu-btn')) {
            toggleMenuDropdown($button);
        } else if ($button.length) {
            if ($button.hasClass('start-stop-btn')) toggleTimer(projectId, taskId, $button);
            if ($button.hasClass('view-log-btn')) showLogs(projectId, taskId);
            if ($button.hasClass('notes-btn')) openNotesView(projectId, taskId);
        } else if ($menuItem.length) {
            // We re-fetch projectId from the menuItem's context here
            const actionProjectId = parseInt($menuItem.closest('[data-project-id]')?.data('projectId'));
            const actionTaskId = parseInt($menuItem.closest('[data-task-id]')?.data('taskId'));
            handleMenuItemClick($menuItem, actionProjectId, actionTaskId);
        }
    }

    /**
     * Toggles the visibility of a project's task list.
     */
    function toggleProjectExpansion($projectHeader) {
        $projectHeader.toggleClass('expanded');
        $projectHeader.next('.task-list-container').toggleClass('hidden');
        $projectHeader.find('.chevron').toggleClass('rotate');
    }

    /**
     * Toggles the visibility of a context menu dropdown.
     */
    function toggleMenuDropdown($button) {
        const $dropdown = $button.next('.menu-dropdown');
        const $currentCard = $button.closest('.project-card');

        $('.project-card').not($currentCard).removeClass('menu-open');
        $('.menu-dropdown').not($dropdown).addClass('hidden');

        $dropdown.toggleClass('hidden');
        $currentCard.toggleClass('menu-open', !$dropdown.hasClass('hidden'));
    }
    
    /**
     * Handles clicks on items within a context menu.
     */
    function handleMenuItemClick($menuItem, projectId, taskId) {
        const action = $menuItem.data('action');
        const type = $menuItem.closest('.menu-container').find('.menu-btn').data('type');

        if (action === 'edit') openEditModal(type, projectId, taskId);
        if (action === 'delete') openConfirmModal({ type, projectId, taskId });
        if (action === 'export') exportProjectToCSV(projectId);
        if (action === 'complete') toggleProjectComplete(projectId);
        if (action === 'archive') archiveProject(projectId);
        if (action === 'complete-and-archive') completeAndArchiveProject(projectId);

        $menuItem.closest('.menu-dropdown').addClass('hidden');
    }

    /**
     * Handles the search input event.
     */
    function handleSearch() {
        currentFilter = $searchInput.val().toLowerCase();
        $clearSearchBtn.toggleClass('hidden', !currentFilter);
        render();
    }

    /**
     * Clears the search input and re-renders the list.
     */
    function clearSearch() {
        $searchInput.val('');
        currentFilter = '';
        $clearSearchBtn.addClass('hidden');
        render();
    }

    /**
     * Closes dropdown menus if a click occurs outside of them.
     */
    function closeMenusOnClickOutside(e) {
        if (!$(e.target).closest('.menu-container, #settings-menu-container').length) {
            $('.menu-dropdown').addClass('hidden');
            $('.project-card').removeClass('menu-open');
        }
    }


    // --- 5. CORE FEATURE LOGIC ---
    // This section contains the primary logic for features like timers, idle detection,
    // theming, and settings.

    /**
     * Toggles a task's timer on or off.
     */
    async function toggleTimer(projectId, taskId, $button) {
        if ($button) $button.addClass('loading');
        
        const project = _.find(projects, { id: projectId });
        const task = _.find(project.tasks, { id: taskId });

        // If concurrent timers are not allowed, stop any other running task.
        if (!allowConcurrentTimers) {
            const runningTasksList = findAllRunningTasks();
            _.forEach(runningTasksList, running => {
                if (running.task.id !== taskId) {
                    const t = running.task;
                    t.isRunning = false;
                    const end = Date.now();
                    t.totalTime += end - t.currentStartTime;
                    t.logs.push({ start: t.currentStartTime, end });
                    clearInterval(timers[t.id]);
                    delete timers[t.id];
                }
            });
        }

        task.isRunning = !task.isRunning;

        if (task.isRunning) {
            // Start the timer
            task.currentStartTime = Date.now();
            startTimerInterval(projectId, task);
            startIdleDetection();
        } else {
            // Stop the timer
            const endTime = Date.now();
            task.totalTime += endTime - task.currentStartTime;
            const logEntry = { start: task.currentStartTime, end: endTime };
            task.logs.push(logEntry);
            task.currentStartTime = null;
            clearInterval(timers[task.id]);
            delete timers[task.id];
            stopIdleDetection();
            
            // Prepare data for Google Sheet sync.
            const rowData = [
                project.name, task.name, project.customer || "N/A",
                task.tags.join(", "), formatDate(new Date(logEntry.start)),
                new Date(logEntry.start).toLocaleTimeString(), formatDate(new Date(logEntry.end)),
                new Date(logEntry.end).toLocaleTimeString(), formatTime(logEntry.end - logEntry.start)
            ];

            // Sync if online, otherwise queue for later.
            if (navigator.onLine) {
                await window.electronAPI.appendToSheet(rowData);
            } else {
                await queueForSync(rowData);
            }
        }
        
        saveData();
        render();
        updateGlobalTimerUI();
    }

    /**
     * Starts a setInterval to update a task's timer display every second.
     */
    function startTimerInterval(projectId, task) {
        if (timers[task.id]) clearInterval(timers[task.id]);
        
        const project = _.find(projects, { id: projectId });
        if (!project) return;

        timers[task.id] = setInterval(() => {
            const elapsed = Date.now() - task.currentStartTime;
            const currentTaskTotal = task.totalTime + elapsed;
            
            // Update the timer display in the task item.
            $(`#timer-${task.id}`).text(formatTime(currentTaskTotal));

            // Update the global timer bar if this task is currently displayed.
            if (runningTasks[globalTimerIndex]?.task.id === task.id) {
                $('#global-timer-time').text(formatTime(currentTaskTotal));
            }
            
            // Update the project's total time and budget progress bar.
            let projectTotalMs = _.sumBy(project.tasks, t => (t.id === task.id) ? currentTaskTotal : t.totalTime);
            updateProjectTimeAndBudget(projectId, project.budget, projectTotalMs);
        }, 1000);
    }

    /**
     * Updates a project's total time and budget display during a running timer.
     */
    function updateProjectTimeAndBudget(projectId, projectBudget, projectTotalMs) {
        const $projectTotalEl = $(`#project-total-${projectId}`);
        if ($projectTotalEl.length) {
            $projectTotalEl.text(`Total Time: ${formatTime(projectTotalMs)}`);
            const $budgetInfoEl = $projectTotalEl.siblings('.project-budget-info');
            if ($budgetInfoEl.length) {
                const totalHours = projectTotalMs / 3600000;
                const percentage = Math.min((totalHours / projectBudget) * 100, 100);
                $budgetInfoEl.find('span:first-child').text(`${totalHours.toFixed(1)}h / ${projectBudget}h`);
                $budgetInfoEl.find('span:last-child').text(`${Math.round(percentage)}%`);
                $budgetInfoEl.next('.progress-bar-container').find('.progress-bar').css('width', `${percentage}%`);
            }
        }
    }

    /**
     * Starts monitoring for system idle time if a timer is running.
     */
    function startIdleDetection() {
        if (idleInfo.timer || findAllRunningTasks().length === 0) return;
        
        idleInfo.timer = setInterval(async () => {
            const idleSeconds = await window.electronAPI.getSystemIdleTime();
            if ($idleModal.hasClass('hidden') && idleSeconds > IDLE_TIMEOUT_MINUTES * 60) {
                const runningTaskInfo = findAllRunningTasks()[0]; // Only checks the first running task for now
                if (runningTaskInfo) handleIdleDetected(runningTaskInfo);
            }
        }, 5000);
    }

    /**
     * Stops monitoring for system idle time.
     */
    function stopIdleDetection() {
        if (findAllRunningTasks().length > 0) return;
        clearInterval(idleInfo.timer);
        idleInfo.timer = null;
    }

    /**
     * Handles the logic when system idle is detected.
     */
    function handleIdleDetected(runningTaskInfo) {
        clearInterval(idleInfo.timer);
        idleInfo.timer = null;
        idleInfo.detectedAt = Date.now();
        idleInfo.activeTaskInfo = runningTaskInfo;
        
        // Stop the visual timer update for the task that triggered the idle state.
        clearInterval(timers[runningTaskInfo.task.id]);
        
        $('#idle-duration').text(`${IDLE_TIMEOUT_MINUTES} minutes`);
        $idleModal.removeClass('hidden');
    }

    /**
     * Handles the "Keep Time" action from the idle modal.
     */
    function handleIdleKeep() {
        if (!idleInfo.activeTaskInfo) return;
        const { project, task } = idleInfo.activeTaskInfo;
        startTimerInterval(project.id, task); // Resume the timer interval.
        $idleModal.addClass('hidden');
        idleInfo = { timer: null, detectedAt: null, activeTaskInfo: null };
        startIdleDetection();
    }
    
    /**
     * Handles the "Discard Time" action from the idle modal.
     */
    function handleIdleDiscard() {
        if (!idleInfo.activeTaskInfo) return;
        const { project, task } = idleInfo.activeTaskInfo;
        // Adjust the start time forward to effectively discard the idle period.
        task.currentStartTime += (IDLE_TIMEOUT_MINUTES * 60 * 1000);
        startTimerInterval(project.id, task);
        $idleModal.addClass('hidden');
        idleInfo = { timer: null, detectedAt: null, activeTaskInfo: null };
        startIdleDetection();
    }

    /**
     * Updates the global timer bar UI based on the currently running tasks.
     */
    function updateGlobalTimerUI() {
        runningTasks = findAllRunningTasks();

        if (runningTasks.length === 0) {
            $globalTimerBar.addClass('hidden');
            globalTimerIndex = 0;
            return;
        }

        // Ensure the index is valid if a task was stopped.
        if (globalTimerIndex >= runningTasks.length) {
            globalTimerIndex = runningTasks.length - 1;
        }

        const { project, task } = runningTasks[globalTimerIndex];
        
        $('#global-timer-project').text(project.name);
        $('#global-timer-task').text(task.name);

        // Show navigation controls only if there are multiple running tasks.
        const showControls = runningTasks.length > 1;
        $('#global-timer-prev, #global-timer-next, #global-timer-counter').toggleClass('hidden', !showControls);
        $('#global-timer-counter').text(`${globalTimerIndex + 1} / ${runningTasks.length}`);
        
        // Manually update the time display for the selected task.
        const elapsed = Date.now() - task.currentStartTime;
        const currentTaskTotal = task.totalTime + elapsed;
        $('#global-timer-time').text(formatTime(currentTaskTotal));

        $globalTimerBar.removeClass('hidden');
    }
    
    /**
     * Handles the stop button on the global timer bar.
     */
    function handleGlobalStop() {
        if (runningTasks[globalTimerIndex]) {
            const { project, task } = runningTasks[globalTimerIndex];
            // Find the corresponding button on the task item to show the loading spinner.
            const $button = $(`[data-task-id="${task.id}"] .start-stop-btn`);
            toggleTimer(project.id, task.id, $button);
        }
    }

    /**
     * Returns a function to cycle through the global timer display.
     */
    function cycleGlobalTimer(direction) {
        return () => {
            if (runningTasks.length > 1) {
                globalTimerIndex = (globalTimerIndex + direction + runningTasks.length) % runningTasks.length;
                updateGlobalTimerUI();
            }
        };
    }
    
    /**
     * Handles global keyboard shortcuts.
     */
    function handleKeyboardShortcuts(e) {
        if (e.key === 'Escape') {
            $('.modal').addClass('hidden');
            closeNotesView();
        }
        if ($('.modal:not(.hidden)').length) return; // Don't trigger shortcuts if a modal is open.
        
        // Ctrl/Cmd + N opens the "Add Project" modal.
        // Ctrl/Cmd + Shift + N opens the "Add Task" modal for the first project.
        if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
            e.preventDefault();
            if (e.shiftKey) {
                const firstProject = _.find(projects, p => !p.isComplete);
                if (firstProject) openAddTaskModal(firstProject.id);
            } else {
                openAddProjectModal();
            }
        }
    }
    
    /**
     * Filters projects and tasks based on the current search filter.
     */
    function getFilteredProjects() {
        if (!currentFilter) return projects;
        
        const lowerCaseFilter = currentFilter.toLowerCase();
        
        return _.filter(projects, project => {
            // Check if project name, customer, or any task details match the filter.
            const projectMatch = project.name.toLowerCase().includes(lowerCaseFilter) ||
                                (project.customer && project.customer.toLowerCase().includes(lowerCaseFilter));
            
            const taskMatch = _.some(project.tasks, task => 
                task.name.toLowerCase().includes(lowerCaseFilter) ||
                _.some(task.tags, tag => tag.toLowerCase().includes(lowerCaseFilter))
            );
            return projectMatch || taskMatch;

        }).map(project => {
            // If the project itself doesn't match, filter its tasks to only show matching ones.
            if (project.name.toLowerCase().includes(lowerCaseFilter) || (project.customer && project.customer.toLowerCase().includes(lowerCaseFilter))) {
                return project;
            }
            return {
                ...project,
                tasks: _.filter(project.tasks, task => 
                    task.name.toLowerCase().includes(lowerCaseFilter) ||
                    _.some(task.tags, tag => tag.toLowerCase().includes(lowerCaseFilter))
                )
            };
        });
    }

    /**
     * Applies the selected accent color by setting CSS variables.
     */
    function applyAccentColor(colorName) {
        const palette = colorPalettes[colorName];
        if (!palette) return;
        _.forEach(palette.colors, (value, key) => {
            document.documentElement.style.setProperty(key, value);
        });
        // Update the active state of the color swatch buttons.
        $('.color-swatch').each((i, swatch) => {
            $(swatch).toggleClass('active', $(swatch).data('color') === colorName);
        });
        localStorage.setItem('accent_color', colorName);
    }

    /**
     * Sets up the settings modal, including creating color swatches.
     */
    function setupSettingsModal() {
        // Only create the color swatches once.
        if ($colorSwatchesContainer.children().length === 0) {
            const savedAccent = localStorage.getItem('accent_color') || 'yellow';
            _.forEach(colorPalettes, (palette, colorName) => {
                const swatch = $('<button></button>')
                    .addClass('color-swatch')
                    .toggleClass('active', colorName === savedAccent)
                    .attr('title', palette.name)
                    .data('color', colorName)
                    .css('backgroundColor', palette.colors['--accent-primary']);
                $colorSwatchesContainer.append(swatch);
            });
        }
        $('#app-settings-btn').on('click', (e) => {
            e.preventDefault();
            // Set the toggle to its correct state before opening.
            $('#concurrent-tasks-toggle').prop('checked', allowConcurrentTimers);
            $('#include-notes-toggle').prop('checked', includeNotesInExport);
            $settingsModal.removeClass('hidden');
            $('#settings-dropdown').addClass('hidden');
        });
        $('#close-settings-modal').on('click', () => $settingsModal.addClass('hidden'));
        $colorSwatchesContainer.on('click', '.color-swatch', (e) => {
            applyAccentColor($(e.currentTarget).data('color'));
        });
    }

    /**
     * Handles the state change for the concurrent timers toggle.
     */
    function handleConcurrentToggle(e) {
        allowConcurrentTimers = $(e.currentTarget).is(':checked');
        localStorage.setItem('allow_concurrent_timers', allowConcurrentTimers);
    }
    
    function handleIncludeNotesToggle(e) {
        includeNotesInExport = $(e.currentTarget).is(':checked');
        localStorage.setItem('include_notes_in_export', includeNotesInExport);
    }
    
    // Defines the icons for the theme toggle button.
    const themeIcons = {
        system: '<i data-feather="monitor"></i>',
        light: '<i data-feather="sun"></i>',
        dark: '<i data-feather="moon"></i>'
    };

    /**
     * Sets up the theme toggle button and system theme change listener.
     */
    function setupTheme() {
        $('#theme-btn').on('click', () => {
            const themes = ['system', 'light', 'dark'];
            currentTheme = themes[(_.indexOf(themes, currentTheme) + 1) % themes.length];
            localStorage.setItem('theme_preference', currentTheme);
            updateTheme();
        });
        window.electronAPI.onThemeUpdate(handleSystemThemeChange);
        updateTheme();
    }
    
    /**
     * Sends the current theme preference to the main process and updates the UI.
     */
    async function updateTheme() {
        const shouldUseDark = await window.electronAPI.setTheme(currentTheme);
        handleSystemThemeChange(shouldUseDark);
        $('#theme-btn').html(themeIcons[currentTheme]);
        feather.replace();
    }

    /**
     * Toggles the 'dark' class on the HTML element based on the system theme.
     */
    function handleSystemThemeChange(shouldUseDark) {
        $('html').toggleClass('dark', shouldUseDark);
    }
    

    // --- 6. MODAL HANDLING ---
    // Functions for opening, closing, and processing data from modals.

    function openAddProjectModal() {
        $('#project-modal-title').text('Add New Project');
        $('#project-form')[0].reset();
        $('#project-id').val(''); // Ensure ID is empty for a new project.
        $projectModal.removeClass('hidden');
        $('#project-name').focus();
    }

    function openEditModal(type, projectId, taskId) {
        if (type === "project") {
            const project = _.find(projects, { id: projectId });
            $('#project-modal-title').text('Edit Project');
            $('#project-id').val(project.id);
            $('#project-name').val(project.name);
            $('#project-customer').val(project.customer || '');
            $('#project-budget').val(project.budget > 0 ? project.budget : '');
            $projectModal.removeClass("hidden");
        } else { // type === "task"
            const project = _.find(projects, { id: projectId });
            const task = _.find(project.tasks, { id: taskId });
            $('#edit-task-id').val(task.id);
            $('#edit-task-project-id').val(project.id);
            $('#edit-task-name').val(task.name);
            $('#edit-task-tags').val(task.tags.join(", "));
            $editTaskModal.removeClass("hidden");
        }
    }

    function handleSaveProject(e) {
        e.preventDefault();
        const id = parseInt($('#project-id').val());
        const name = $('#project-name').val().trim();
        const customer = $('#project-customer').val().trim();
        const budget = parseFloat($('#project-budget').val()) || 0;

        if (id) { // If an ID exists, we are editing an existing project.
            const project = _.find(projects, { id });
            Object.assign(project, { name, customer, budget });
        } else { // Otherwise, create a new project.
            projects.unshift({
                id: Date.now(), name, customer, tasks: [], budget,
                isComplete: false, isArchived: false, createdAt: new Date().toISOString()
            });
        }
        
        saveData();
        render();
        closeProjectModal();
    }

    function handleSaveTaskEdit(e) {
        e.preventDefault();
        const taskId = parseInt($('#edit-task-id').val());
        const projectId = parseInt($('#edit-task-project-id').val());
        const project = _.find(projects, { id: projectId });
        const task = _.find(project.tasks, { id: taskId });

        const name = $('#edit-task-name').val().trim();
        const tags = _.map($('#edit-task-tags').val().split(','), s => _.trim(s).toLowerCase());
        
        Object.assign(task, { name, tags });

        saveData();
        render();
        closeEditTaskModal();
    }

    function closeProjectModal() {
        $projectModal.addClass("hidden");
        $('#project-form')[0].reset();
    }

    function closeEditTaskModal() {
        $editTaskModal.addClass("hidden");
        $('#edit-task-form')[0].reset();
    }

    function openAddTaskModal(projectId) {
        const project = _.find(projects, { id: projectId });
        if (!project) return;
        $('#add-task-modal-title').text(`Add Task to "${project.name}"`);
        $('#add-task-project-id').val(projectId);
        $addTaskModal.removeClass('hidden');
    }

    function closeAddTaskModal() {
        $addTaskModal.addClass('hidden');
        $('#add-task-modal-form')[0].reset();
    }

    function handleAddTaskFromModal(e) {
        e.preventDefault();
        const projectId = parseInt($('#add-task-project-id').val());
        const project = _.find(projects, { id: projectId });
        if (!project) return;
        const name = $('#modal-task-name').val().trim();
        const tags = _.map($('#modal-task-tags').val().split(','), _.trim);
        project.tasks.push({
            id: Date.now(), name, tags, logs: [], totalTime: 0,
            isRunning: false, currentStartTime: null, notes: [],
            createdAt: new Date().toISOString()
        });
        saveData();
        render();
        closeAddTaskModal();
    }

    function closeConfirmModal() {
        $confirmModal.addClass("hidden");
        actionToConfirm = null;
    }

    function openConfirmModal(action) {
        // Store the action to be performed if the user confirms.
        actionToConfirm = () => {
            if (action.type === 'import') {
                projects = action.data;
            } else if (action.type === 'project') {
                _.remove(projects, { id: action.projectId });
            } else if (action.type === 'task') {
                const project = _.find(projects, { id: action.projectId });
                _.remove(project.tasks, { id: action.taskId });
            }
        };
        $('#confirm-title').text(action.type === 'import' ? 'Confirm Import' : 'Confirm Deletion');
        $('#confirm-message').text(action.type === 'import' ? 'This will overwrite all current data. Are you sure?' : 'This action cannot be undone. Are you sure?');
        $confirmModal.removeClass('hidden');
    }

    function handleConfirm() {
        if (!actionToConfirm) return;
        actionToConfirm();
        saveData();
        render();
        closeConfirmModal();
    }
    
    /**
     * Handles the "Export Backup" action from the settings menu.
     */
    async function handleExport() {
        await window.electronAPI.exportData(projects);
        $('#settings-dropdown').addClass('hidden');
    }

    /**
     * Handles the "Import Backup" action from the settings menu.
     */
    async function handleImport() {
        $('#settings-dropdown').addClass('hidden');
        const result = await window.electronAPI.importData();
        if (result.success) {
            openConfirmModal({ type: 'import', data: result.data });
        } else if (result.error) {
            alert(`Error importing data: ${result.error}`);
        }
    }
    
    function openGoogleSheetModal() {
        $('#settings-dropdown').addClass('hidden');
        $googleSheetModal.removeClass('hidden');
    }

    function closeGoogleSheetModal() {
        $googleSheetModal.addClass('hidden');
    }
    
    async function handleLinkSheet() {
        const url = $('#google-sheet-url').val().trim();
        if (!url) return alert('Please enter a Google Sheet URL.');
        await window.electronAPI.setSheetUrl(url);
        const result = await window.electronAPI.linkGoogleSheet();
        if (result.success) {
            alert('Successfully linked to Google Sheet!');
            await checkSheetStatus();
            closeGoogleSheetModal();
        } else {
            alert(`Failed to link sheet: ${result.error || 'Authorization failed or was cancelled.'}`);
        }
    }

    /**
     * Checks the Google Sheet URL and updates the status indicator.
     */
    async function checkSheetStatus() {
        const url = await window.electronAPI.getSheetUrl();
        $('#google-sheet-url').val(url);
        $('#sheet-status').toggleClass('linked', !!url).attr('title', url ? 'Linked' : 'Not Linked');
    }

    /**
     * Exports a single project's time logs to a CSV file.
     */
    async function exportProjectToCSV(projectId) {
        // Ensure projectId is a valid number before proceeding.
        if (typeof projectId !== 'number' || isNaN(projectId)) {
            console.error("Export failed: Invalid projectId provided.", projectId);
            return; // Stop execution if the ID is invalid
        }

        const project = _.find(projects, { id: projectId });
        if (!project) {
            console.error("Export failed: Could not find project with ID:", projectId);
            return; // Stop if the project isn't found
        }

        // --- Add the new budget headers ---
        const headers = [
            'Project', 'Task', 'Customer', 'Tags', 'Task Created', 
            'Project Budget (Hours)', 'Task % of Budget',
            'Start Date', 'Start Time', 'End Date', 'End Time', 'Duration (HH:MM:SS)'
        ];
        if (includeNotesInExport) headers.push('Notes');
        
        // Helper function to safely escape a string for CSV format.
        const escapeCsvCell = (cell) => {
            const cellString = String(cell || '');
            if (cellString.includes(',') || cellString.includes('"') || cellString.includes('\n')) {
                const escapedCell = cellString.replace(/"/g, '""');
                return `"${escapedCell}"`;
            }
            return cellString;
        };

        const rows = _.flatMap(project.tasks, task => {
            // --- Calculate the budget percentage for the task ---
            let budgetPercentage = 'N/A';
            if (project.budget > 0) {
                const taskTotalHours = task.totalTime / 3600000;
                const percentage = (taskTotalHours / project.budget) * 100;
                budgetPercentage = `${percentage.toFixed(2)}%`;
            }

            const taskEvents = [];
            
            _.forEach(task.logs, log => {
                taskEvents.push({ type: 'log', time: new Date(log.start).getTime(), log });
            });

            if (includeNotesInExport && task.notes && task.notes.length > 0) {
                _.forEach(task.notes, note => {
                    taskEvents.push({ type: 'note', time: new Date(note.timestamp).getTime(), note });
                });
            }

            taskEvents.sort((a, b) => a.time - b.time);

            return _.map(taskEvents, event => {
                const baseRow = [
                    project.name, task.name, project.customer || 'N/A', task.tags.join(', '),
                    task.createdAt ? formatDate(new Date(task.createdAt)) : 'N/A',
                    project.budget > 0 ? project.budget : 'N/A',
                    budgetPercentage
                ];

                if (event.type === 'log') {
                    baseRow.push(
                        formatDate(new Date(event.log.start)), new Date(event.log.start).toLocaleTimeString(),
                        formatDate(new Date(event.log.end)), new Date(event.log.end).toLocaleTimeString(),
                        formatTime(event.log.end - event.log.start)
                    );
                    if (includeNotesInExport) baseRow.push('');
                } else if (event.type === 'note') {
                    baseRow.push(
                        formatDate(new Date(event.note.timestamp)),
                        new Date(event.note.timestamp).toLocaleTimeString(),
                        '', '', ''
                    );
                    if (includeNotesInExport) {
                        const text = $('<div>').html(event.note.content).text().trim();
                        const noteDate = new Date(event.note.timestamp).toLocaleString();
                        baseRow.push(`[${noteDate}] ${text}`);
                    }
                }
                return baseRow;
            });
        });

        // Process each row to escape its cells before joining.
        const csvRows = [headers, ...rows].map(row => row.map(escapeCsvCell).join(','));
        let csvContent = csvRows.join('\n');
        const safeFileName = project.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'export';

        await window.electronAPI.saveCsv({ data: csvContent, defaultPath: safeFileName });
    }

    /**
     * Exports a single task's time logs to a CSV file.
     * @param {object} project - The parent project of the task.
     * @param {object} task - The task whose logs will be exported.
     */
    async function exportTaskToCSV(project, task) {
        if (!project || !task) {
            console.error("Export failed: Invalid project or task provided.");
            return;
        }

        const headers = ['Project', 'Task', 'Customer', 'Tags', 'Task Created', 'Start Date', 'Start Time', 'End Date', 'End Time', 'Duration (HH:MM:SS)'];
        if (includeNotesInExport) headers.push('Notes');
        
        // Helper function to safely escape a string for CSV format.
        const escapeCsvCell = (cell) => {
            const cellString = String(cell || '');
            if (cellString.includes(',') || cellString.includes('"') || cellString.includes('\n')) {
                const escapedCell = cellString.replace(/"/g, '""');
                return `"${escapedCell}"`;
            }
            return cellString;
        };
        
        const taskEvents = [];
        _.forEach(task.logs, log => {
            taskEvents.push({ type: 'log', time: new Date(log.start).getTime(), log });
        });

        if (includeNotesInExport && task.notes && task.notes.length > 0) {
            _.forEach(task.notes, note => {
                taskEvents.push({ type: 'note', time: new Date(note.timestamp).getTime(), note });
            });
        }
        taskEvents.sort((a, b) => a.time - b.time);

        // Map over the events of the specified task.
        const rows = _.map(taskEvents, event => {
            const row = [
                project.name, task.name, project.customer || 'N/A', task.tags.join(', '),
                task.createdAt ? formatDate(new Date(task.createdAt)) : 'N/A'
            ];

            if (event.type === 'log') {
                row.push(
                    formatDate(new Date(event.log.start)), new Date(event.log.start).toLocaleTimeString(),
                    formatDate(new Date(event.log.end)), new Date(event.log.end).toLocaleTimeString(),
                    formatTime(event.log.end - event.log.start)
                );
                if (includeNotesInExport) row.push('');
            } else if (event.type === 'note') {
                row.push(
                    formatDate(new Date(event.note.timestamp)),
                    new Date(event.note.timestamp).toLocaleTimeString(),
                    '', '', ''
                );
                if (includeNotesInExport) {
                    const text = $('<div>').html(event.note.content).text().trim();
                    const noteDate = new Date(event.note.timestamp).toLocaleString();
                    row.push(`[${noteDate}] ${text}`);
                }
            }
            return row;
        });

        const csvRows = [headers, ...rows].map(row => row.map(escapeCsvCell).join(','));
        let csvContent = csvRows.join('\n');
        
        // Create the new, specific filename.
        const safeProjectName = project.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const safeTaskName = task.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const safeFileName = `${safeProjectName}-${safeTaskName}`;

        await window.electronAPI.saveCsv({ data: csvContent, defaultPath: safeFileName });
    }
    
    /**
     * Toggles a project's completion status and triggers a confetti animation.
     */
    function toggleProjectComplete(projectId) {
        const project = _.find(projects, { id: projectId });
        if (project) {
            project.isComplete = !project.isComplete;
            if (project.isComplete) {
                // Fun confetti animation on completion!
                triggerConfetti();
            }
            saveData();
            render();
        }
    }
    
    /**
     * Displays the time log entries for a specific task in a modal.
     */
    function showLogs(projectId, taskId) {
        const project = _.find(projects, { id: projectId });
        const task = _.find(project.tasks, { id: taskId });
        $logModal.find('#modal-title').text(`Time Logs for: ${task.name}`);
        const $modalBody = $logModal.find('#modal-body').empty();
        const $modalFooter = $logModal.find('#modal-footer').empty();
        
        if (_.isEmpty(task.logs)) {
            $modalBody.html("<p>No time has been logged for this task yet.</p>");
        } else {
            const rowsHTML = _.map(task.logs.slice().reverse(), log => `
                <tr>
                    <td>${new Date(log.start).toLocaleString()}</td>
                    <td>${new Date(log.end).toLocaleString()}</td>
                    <td>${formatTime(log.end - log.start)}</td>
                </tr>`).join("");
            $modalBody.html(`
                <table class="log-table">
                    <thead><tr><th>Start Time</th><th>End Time</th><th>Duration</th></tr></thead>
                    <tbody>${rowsHTML}</tbody>
                </table>`);
        }
        
        const $footerContent = $(`
            <div class="log-footer">
                <p>Total: ${formatTime(task.totalTime)}</p>
                <button id="export-csv-btn">Export Task CSV</button>
            </div>`);
        $footerContent.find('#export-csv-btn').on('click', () => exportTaskToCSV(project, task));
        $modalFooter.append($footerContent);
        $logModal.removeClass("hidden");
    }

    function archiveProject(projectId) {
        const project = _.find(projects, { id: projectId });
        if (project) {
            project.isArchived = true;
            saveData();
            render();
        }
    }

    /**
     * Marks a project as complete and immediately archives it.
     */
    function completeAndArchiveProject(projectId) {
        const project = _.find(projects, { id: projectId });
        if (project) {
            project.isComplete = true;
            project.isArchived = true;
            triggerConfetti(); // Give the user some celebratory confetti!
            saveData();
            render();
        }
    }

    /**
     * Opens a modal to display and manage archived projects.
     */
    function showArchivedProjects() {
        $('#settings-dropdown').addClass('hidden'); // <-- Add this line to close the menu

        const archivedProjects = projects.filter(p => p.isArchived);
        const $modalBody = $('#archive-modal-body').empty();

        if (_.isEmpty(archivedProjects)) {
            $modalBody.html('<p class="no-tasks">You have no archived projects.</p>');
        } else {
            _.forEach(archivedProjects, project => {
                const itemHTML = `
                    <div class="archived-item" data-project-id="${project.id}">
                        <div class="archived-item-info">
                            <h4>${_.escape(project.name)}</h4>
                            <p>Customer: ${_.escape(project.customer) || 'N/A'}</p>
                        </div>
                        <div class="archived-item-controls">
                            <button class="unarchive-btn">Unarchive</button>
                            <button class="danger delete-btn">Delete</button>
                        </div>
                    </div>
                `;
                $modalBody.append(itemHTML);
            });
        }

        // Open the modal
        $('#archive-modal').removeClass('hidden');
    }

    /**
     * Unarchives a project, making it visible again.
     */
    function unarchiveProject(projectId) {
        const project = _.find(projects, { id: projectId });
        if (project) {
            project.isArchived = false;
            saveData();
            render(); // Re-render the main list
            showArchivedProjects(); // Refresh the modal list
        }
    }

    // --- 7. NOTES FEATURE FUNCTIONS ---

    function initializeQuillEditor() {
        if (quill) return;
        quill = new Quill('#notes-editor', {
            theme: 'snow',
            modules: { toolbar: '#notes-toolbar' },
            placeholder: 'Add a timestamped note...'
        });
    }

    function openNotesView(projectId, taskId) {
        activeNotesTaskId = taskId;
        const project = _.find(projects, { id: projectId });
        const task = _.find(project.tasks, { id: taskId });

        $('#notes-task-title').text(`Notes for: ${task.name}`);
        renderNotesForTask(task);
        $notesView.removeClass('hidden');
        initializeQuillEditor();
    }

    /**
     * Sets up the event listener for the notes list.
     */
    function setupNotesListener() {
        $('#notes-list').on('click', '.delete-note-btn', function() {
            const noteTimestamp = $(this).closest('.note-item').data('timestamp');
            if (activeNotesTaskId && noteTimestamp) {
                handleDeleteNote(activeNotesTaskId, noteTimestamp);
            }
        });
    }

    /**
     * Renders the list of notes for the active task and scrolls to the bottom.
     */
    function renderNotesForTask(task) {
        const $notesList = $('#notes-list').empty();
        if (!task.notes || _.isEmpty(task.notes)) {
            $notesList.html('<p class="no-tasks">No notes for this task yet.</p>');
            return;
        }

        const sortedNotes = _.sortBy(task.notes, 'timestamp');

        _.forEach(sortedNotes, note => {
            const noteHTML = `
                <div class="note-item" data-timestamp="${note.timestamp}">
                    <div class="note-meta">
                        <span>${new Date(note.timestamp).toLocaleString()}</span>
                        <button class="delete-note-btn" title="Delete Note"><i data-feather="trash-2"></i></button>
                    </div>
                    <div class="note-content">${note.content}</div>
                </div>`;
            $notesList.append(noteHTML);
        });

        feather.replace(); // Re-initialize icons for the new delete buttons

        setTimeout(() => {
            const notesListElement = $notesList[0];
            if (notesListElement) {
                notesListElement.scrollTop = notesListElement.scrollHeight;
            }
        }, 0);
    }

    /**
     * Handles the deletion of a specific note from a task.
     */
    function handleDeleteNote(taskId, noteTimestamp) {
        const taskInfo = findTaskById(taskId);
        if (taskInfo && taskInfo.task.notes) {
            // Remove the note with the matching timestamp
            _.remove(taskInfo.task.notes, (note) => note.timestamp === noteTimestamp);
            saveData();
            renderNotesForTask(taskInfo.task); // Re-render the notes list
        }
    }

    function closeNotesView() {
        $notesView.addClass('hidden');
        activeNotesTaskId = null;
        if (quill) {
            quill.setText('');
        }
    }

    function handleAddNote() {
        if (!activeNotesTaskId || !quill) return;

        const content = quill.root.innerHTML;
        if (quill.getLength() <= 1) return;

        const taskInfo = findTaskById(activeNotesTaskId);
        if (taskInfo) {
            if (!taskInfo.task.notes) {
                taskInfo.task.notes = [];
            }
            taskInfo.task.notes.push({
                timestamp: new Date().toISOString(),
                content: content
            });
            saveData();
            renderNotesForTask(taskInfo.task);
            quill.setText('');
        }
    }

    // --- 8. UTILITY & HELPER FUNCTIONS ---

    function triggerConfetti() {
        const duration = 2 * 1000;
        const animationEnd = Date.now() + duration;
        const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 100 };
        const randomInRange = (min, max) => Math.random() * (max - min) + min;

        const interval = setInterval(() => {
            const timeLeft = animationEnd - Date.now();
            if (timeLeft <= 0) return clearInterval(interval);
            const particleCount = 50 * (timeLeft / duration);
            confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } });
            confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
        }, 250);
    }

    async function queueForSync(rowData) {
        const queue = await window.electronAPI.getPendingSyncs();
        queue.push(rowData);
        await window.electronAPI.setPendingSyncs(queue);
    }

    /**
     * Processes any pending syncs in the queue.
     */
    async function processSyncQueue() {
        let queue = await window.electronAPI.getPendingSyncs();
        if (_.isEmpty(queue)) return;
        
        for (const rowData of queue) {
            const result = await window.electronAPI.appendToSheet(rowData);
            if (!result.success) {
                console.error('Failed to sync an entry, stopping queue processing.', result.error);
                return; // Stop if one fails to maintain order.
            }
        }
        
        await window.electronAPI.setPendingSyncs([]); // Clear the queue on success.
    }

    /**
     * Finds and returns an array of all currently running tasks.
     */
    function findAllRunningTasks() {
        const tasks = [];
        for (const project of projects) {
            for (const task of project.tasks) {
                if (task.isRunning) {
                    tasks.push({ project, task });
                }
            }
        }
        return tasks;
    }

    function findTaskById(taskId) {
        for (const project of projects) {
            const task = _.find(project.tasks, { id: taskId });
            if (task) return { project, task };
        }
        return null;
    }
    
    /**
     * Formats milliseconds into a HH:MM:SS string.
     */
    function formatTime(ms) {
        if (isNaN(ms) || ms < 0) return "00:00:00";
        const s = Math.floor(ms / 1000);
        return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }

    /**
     * Formats a Date object into a DD/MM/YYYY string.
     */
    function formatDate(date) {
        const d = new Date(date);
        return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    }
    
    /**
     * Handles changes in the network connection status.
     */
    function handleOnlineStatusChange() {
        const isOnline = navigator.onLine;
        // Visually disable the Google Sheet sync button if offline.
        $('#google-sheet-modal-btn').css({ opacity: isOnline ? 1 : 0.5, pointerEvents: isOnline ? 'auto' : 'none' })
            .attr('title', isOnline ? '' : 'Google Sheet Sync is disabled while offline');
        if (isOnline) {
            processSyncQueue();
        }
    }

    // --- 9. START APPLICATION ---
    initialize();
});