import { IoCloseOutline } from "react-icons/io5";
import { VscTerminal } from "react-icons/vsc";

function TerminalTabs({ tabs, activeTabId, onSelectTab, onCloseTab }) {
	if (tabs.length === 0) return null;

	return (
		<div className="flex items-center gap-1 overflow-x-auto border-b border-darkHover bg-dark px-2">
			{tabs.map((tab) => {
				const isActive = tab.id === activeTabId;
				return (
					<div
						key={tab.id}
						onClick={() => onSelectTab(tab.id)}
						className={`flex cursor-pointer items-center gap-2 rounded-t px-3 py-1.5 text-sm ${
							isActive ? "bg-darkHover text-light" : "text-light/50 hover:bg-darkHover/50"
						}`}
					>
						<VscTerminal size={14} />
						<span className="whitespace-nowrap">{tab.title}</span>
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onCloseTab(tab.id);
							}}
							title="Close Tab"
							className="rounded p-0.5 hover:bg-dark"
						>
							<IoCloseOutline size={14} />
						</button>
					</div>
				);
			})}
		</div>
	);
}

export default TerminalTabs;