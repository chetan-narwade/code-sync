import { useAppContext } from "@/context/AppContext";
import { useSocket } from "@/context/SocketContext";
import { TerminalSocketEvent } from "@/types/terminal";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import TerminalHeader from "./TerminalHeader";
import TerminalTabs from "./TerminalTabs";

const MIN_PANEL_HEIGHT = 120;
const MAX_PANEL_HEIGHT_RATIO = 0.85;
const DEFAULT_PANEL_HEIGHT = 280;

// The first terminal in a room always uses this fixed id instead of a
// randomly generated one. That way, if two users in an empty room both open
// the terminal panel at nearly the same moment, they both end up asking the
// server to create/attach to the same session id — the backend's
// createTerminal() is idempotent per id, so this naturally collapses into a
// single shared shell instead of a race that spawns two.
const DEFAULT_TERMINAL_ID = "default";

const XTERM_THEME = {
	background: "#1e1e1e",
	foreground: "#d4d4d4",
	cursor: "#39E079",
	cursorAccent: "#1e1e1e",
	selectionBackground: "#264f78",
	black: "#1e1e1e",
	red: "#f14c4c",
	green: "#39E079",
	yellow: "#e5e510",
	blue: "#3b8eea",
	magenta: "#d670d6",
	cyan: "#29b8db",
	white: "#e5e5e5",
	brightBlack: "#666666",
	brightRed: "#f14c4c",
	brightGreen: "#23d18b",
	brightYellow: "#f5f543",
	brightBlue: "#3b8eea",
	brightMagenta: "#d670d6",
	brightCyan: "#29b8db",
	brightWhite: "#e5e5e5",
};

function TerminalPanel({ isOpen, onClose }) {
	const { socket } = useSocket();
	const { currentUser } = useAppContext();
	const roomId = currentUser.roomId;

	const [tabs, setTabs] = useState([]);
	const [activeTabId, setActiveTabId] = useState(null);
	const [panelHeight, setPanelHeight] = useState(DEFAULT_PANEL_HEIGHT);
	const [isMaximized, setIsMaximized] = useState(false);

	const containerRefs = useRef(new Map()); // terminalId -> HTMLDivElement
	const instanceRefs = useRef(new Map()); // terminalId -> { terminal, fitAddon }
	const historyAppliedRef = useRef(new Set()); // terminalId set, so history replay only happens once
	const panelRef = useRef(null);
	const isResizingRef = useRef(false);

	// ---- xterm instance lifecycle -------------------------------------------

	const getOrCreateInstance = useCallback((terminalId) => {
		if (instanceRefs.current.has(terminalId)) {
			return instanceRefs.current.get(terminalId);
		}

		const terminal = new XTerm({
			convertEol: false,
			cursorBlink: true,
			fontFamily: '"Space Mono", monospace',
			fontSize: 14,
			scrollback: 5000,
			smoothScrollDuration: 125,
			theme: XTERM_THEME,
		});

		const fitAddon = new FitAddon();
		terminal.loadAddon(fitAddon);
		terminal.loadAddon(new WebLinksAddon());

		const instance = { terminal, fitAddon };
		instanceRefs.current.set(terminalId, instance);
		return instance;
	}, []);

	const mountTerminal = useCallback(
		(terminalId) => {
			const container = containerRefs.current.get(terminalId);
			if (!container) return;

			const { terminal, fitAddon } = getOrCreateInstance(terminalId);

			// Only attach to the DOM once — calling terminal.open() again on
			// an already-opened instance throws.
			if (!container.hasChildNodes()) {
				terminal.open(container);

				// Forward every keystroke/paste straight to the backend pty.
				// This naturally carries Ctrl+C (\x03), Ctrl+L (\x0c), and
				// Ctrl+Z (\x1a) through as raw control bytes — the shell on
				// the other end interprets them exactly like a native
				// terminal would, no special-casing needed here for those.
				terminal.onData((data) => {
					socket.emit(TerminalSocketEvent.INPUT, { roomId, terminalId, data });
				});

				// Ctrl+C: copy the current selection instead of sending
				// SIGINT, matching VS Code's terminal behavior (SIGINT is
				// still reachable — it's only intercepted when text is
				// actually selected). Ctrl+V: paste from the system
				// clipboard explicitly, as a reliable fallback alongside the
				// browser's native paste-into-focused-element behavior.
				terminal.attachCustomKeyEventHandler((event) => {
					if (event.type !== "keydown") return true;

					const isCopy = (event.ctrlKey || event.metaKey) && event.key === "c";
					const isPaste = (event.ctrlKey || event.metaKey) && event.key === "v";

					if (isCopy && terminal.hasSelection()) {
						navigator.clipboard?.writeText(terminal.getSelection()).catch(() => {});
						return false;
					}

					if (isPaste) {
						navigator.clipboard
							?.readText()
							.then((text) => {
								if (text) {
									socket.emit(TerminalSocketEvent.INPUT, {
										roomId,
										terminalId,
										data: text,
									});
								}
							})
							.catch(() => {
								// Clipboard read can be blocked by browser
								// permissions — fall back silently to the
								// browser's native paste event instead.
							});
						return false;
					}

					return true;
				});
			}

			requestAnimationFrame(() => {
				try {
					fitAddon.fit();
				} catch {
					// Container can briefly report zero size on first paint; ignore.
				}
			});
		},
		[getOrCreateInstance, roomId, socket],
	);

	const requestTerminal = useCallback(
		(terminalId) => {
			if (!roomId) return;
			const { terminal } = getOrCreateInstance(terminalId);
			socket.emit(TerminalSocketEvent.CREATE, {
				roomId,
				terminalId,
				cols: terminal.cols,
				rows: terminal.rows,
			});
		},
		[getOrCreateInstance, roomId, socket],
	);

	// ---- discover existing sessions for this room on open / reconnect -------

	useEffect(() => {
		if (!isOpen || !roomId) return;
		socket.emit(TerminalSocketEvent.LIST, { roomId });
	}, [isOpen, roomId, socket]);

	useEffect(() => {
		if (!isOpen) return;

		const handleListResult = ({ sessions }) => {
			if (sessions.length > 0) {
				const existingTabs = sessions.map((session, index) => ({
					id: session.id,
					title: session.id === DEFAULT_TERMINAL_ID ? "bash" : `bash ${index + 1}`,
				}));
				setTabs(existingTabs);
				setActiveTabId((prev) => prev ?? existingTabs[0].id);
			} else {
				const defaultTab = { id: DEFAULT_TERMINAL_ID, title: "bash" };
				setTabs([defaultTab]);
				setActiveTabId(defaultTab.id);
			}
		};

		socket.on(TerminalSocketEvent.LIST_RESULT, handleListResult);
		return () => socket.off(TerminalSocketEvent.LIST_RESULT, handleListResult);
	}, [isOpen, socket]);

	// ---- socket event wiring for output / lifecycle / reconnection ----------

	useEffect(() => {
		if (!isOpen) return;

		const handleCreated = ({ terminalId, history }) => {
			const { terminal } = getOrCreateInstance(terminalId);
			// Only replay scrollback the first time this client sees this
			// terminal. On a mere socket reconnect (page never unmounted),
			// the local xterm buffer already has everything it displayed
			// before the drop, so re-writing history again would duplicate it.
			if (history && !historyAppliedRef.current.has(terminalId)) {
				terminal.write(history);
				historyAppliedRef.current.add(terminalId);
			}
		};

		const handleOutput = ({ terminalId, data }) => {
			instanceRefs.current.get(terminalId)?.terminal.write(data);
		};

		const handleClosed = ({ terminalId }) => {
			instanceRefs.current
				.get(terminalId)
				?.terminal.writeln("\r\n\x1b[31m[process exited]\x1b[0m");
		};

		const handleError = ({ terminalId, message }) => {
			instanceRefs.current
				.get(terminalId)
				?.terminal.writeln(`\r\n\x1b[31m[terminal error] ${message}\x1b[0m`);
		};

		// Socket.IO's own reconnection (configured in SocketContext) fires a
		// fresh "connect" event once it's back. Re-request every tab this
		// client already has open so the backend can rebind us to its
		// existing pty session and hand back anything we might have missed.
		const handleReconnect = () => {
			tabs.forEach((tab) => {
				socket.emit(TerminalSocketEvent.LIST, { roomId });
				requestTerminal(tab.id);
			});
		};

		socket.on(TerminalSocketEvent.CREATED, handleCreated);
		socket.on(TerminalSocketEvent.OUTPUT, handleOutput);
		socket.on(TerminalSocketEvent.CLOSED, handleClosed);
		socket.on(TerminalSocketEvent.ERROR, handleError);
		socket.on("connect", handleReconnect);

		return () => {
			socket.off(TerminalSocketEvent.CREATED, handleCreated);
			socket.off(TerminalSocketEvent.OUTPUT, handleOutput);
			socket.off(TerminalSocketEvent.CLOSED, handleClosed);
			socket.off(TerminalSocketEvent.ERROR, handleError);
			socket.off("connect", handleReconnect);
		};
	}, [isOpen, socket, tabs, roomId, getOrCreateInstance, requestTerminal]);

	// Mount + request a pty session for every tab currently in state —
	// covers both the initial population (after LIST_RESULT) and any tab
	// added later via the "+" button.
	useEffect(() => {
		if (!isOpen) return;
		tabs.forEach((tab) => {
			mountTerminal(tab.id);
			requestTerminal(tab.id);
		});
	}, [tabs, isOpen, mountTerminal, requestTerminal]);

	// ---- fit on panel resize / tab switch / window resize --------------------

	const fitActiveTerminal = useCallback(() => {
		const instance = instanceRefs.current.get(activeTabId);
		if (!instance) return;
		try {
			instance.fitAddon.fit();
			const { cols, rows } = instance.terminal;
			socket.emit(TerminalSocketEvent.RESIZE, { roomId, terminalId: activeTabId, cols, rows });
		} catch {
			// Can happen if the container briefly has zero size; safe to ignore.
		}
	}, [activeTabId, roomId, socket]);

	useEffect(() => {
		if (!isOpen || !activeTabId) return;
		fitActiveTerminal();
		instanceRefs.current.get(activeTabId)?.terminal.focus();
	}, [activeTabId, isOpen, fitActiveTerminal]);

	useEffect(() => {
		if (!isOpen) return;
		const handleWindowResize = () => fitActiveTerminal();
		window.addEventListener("resize", handleWindowResize);
		return () => window.removeEventListener("resize", handleWindowResize);
	}, [isOpen, fitActiveTerminal]);

	useEffect(() => {
		if (!isOpen || !panelRef.current) return;
		const observer = new ResizeObserver(() => fitActiveTerminal());
		observer.observe(panelRef.current);
		return () => observer.disconnect();
	}, [isOpen, fitActiveTerminal, panelHeight, isMaximized]);

	// ---- drag-to-resize the bottom panel ---------------------------------------

	const handleDragStart = useCallback(
		(e) => {
			e.preventDefault();
			isResizingRef.current = true;
			document.body.style.cursor = "ns-resize";

			const handleDragMove = (moveEvent) => {
				if (!isResizingRef.current) return;
				const newHeight = window.innerHeight - moveEvent.clientY;
				const maxHeight = window.innerHeight * MAX_PANEL_HEIGHT_RATIO;
				setPanelHeight(Math.min(Math.max(newHeight, MIN_PANEL_HEIGHT), maxHeight));
			};

			const handleDragEnd = () => {
				isResizingRef.current = false;
				document.body.style.cursor = "";
				window.removeEventListener("mousemove", handleDragMove);
				window.removeEventListener("mouseup", handleDragEnd);
				fitActiveTerminal();
			};

			window.addEventListener("mousemove", handleDragMove);
			window.addEventListener("mouseup", handleDragEnd);
		},
		[fitActiveTerminal],
	);

	// ---- tab management -----------------------------------------------------------

	const handleAddTab = useCallback(() => {
		const newTab = { id: uuidv4(), title: `bash ${tabs.length + 1}` };
		setTabs((prev) => [...prev, newTab]);
		setActiveTabId(newTab.id);
	}, [tabs.length]);

	const handleCloseTab = useCallback(
		(terminalId) => {
			socket.emit(TerminalSocketEvent.CLOSE, { roomId, terminalId });

			instanceRefs.current.get(terminalId)?.terminal.dispose();
			instanceRefs.current.delete(terminalId);
			containerRefs.current.delete(terminalId);
			historyAppliedRef.current.delete(terminalId);

			setTabs((prev) => {
				const filtered = prev.filter((tab) => tab.id !== terminalId);
				setActiveTabId((prevActive) => {
					if (prevActive !== terminalId) return prevActive;
					return filtered.length > 0 ? filtered[filtered.length - 1].id : null;
				});
				return filtered;
			});
		},
		[roomId, socket],
	);

	// Dispose every xterm instance when the panel itself unmounts entirely
	// (e.g. leaving the room), so nothing is left listening or holding memory.
	useEffect(() => {
		return () => {
			instanceRefs.current.forEach((instance) => instance.terminal.dispose());
			instanceRefs.current.clear();
			containerRefs.current.clear();
			historyAppliedRef.current.clear();
		};
	}, []);

	if (!isOpen) return null;

	return (
		<div
			ref={panelRef}
			className="flex flex-col border-t border-darkHover bg-dark text-light"
			style={{ height: isMaximized ? "85vh" : panelHeight }}
		>
			<div
				onMouseDown={handleDragStart}
				className="h-1 w-full cursor-ns-resize bg-transparent hover:bg-primary/40"
			/>

			<TerminalHeader
				isMaximized={isMaximized}
				onToggleMaximize={() => setIsMaximized((prev) => !prev)}
				onClose={onClose}
				onAddTab={handleAddTab}
			/>

			<TerminalTabs
				tabs={tabs}
				activeTabId={activeTabId}
				onSelectTab={setActiveTabId}
				onCloseTab={handleCloseTab}
			/>

			<div className="relative flex-1 overflow-hidden px-2 py-1">
				{tabs.map((tab) => (
					<div
						key={tab.id}
						ref={(el) => {
							if (el) containerRefs.current.set(tab.id, el);
						}}
						className="h-full w-full"
						style={{ display: activeTabId === tab.id ? "block" : "none" }}
					/>
				))}
			</div>
		</div>
	);
}

export default TerminalPanel;