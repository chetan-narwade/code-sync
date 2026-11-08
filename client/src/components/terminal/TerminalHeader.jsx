import {
	IoAddOutline,
	IoChevronDownOutline,
	IoChevronUpOutline,
	IoCloseOutline,
} from "react-icons/io5";

function TerminalHeader({ isMaximized, onToggleMaximize, onClose, onAddTab }) {
	return (
		<div className="flex items-center justify-between border-b border-darkHover px-3 py-1.5">
			<span className="text-xs font-semibold uppercase tracking-wide text-light/70">
				Terminal
			</span>
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={onAddTab}
					title="New Terminal"
					className="rounded p-1 hover:bg-darkHover"
				>
					<IoAddOutline size={16} />
				</button>
				<button
					type="button"
					onClick={onToggleMaximize}
					title={isMaximized ? "Restore Panel Size" : "Maximize Panel"}
					className="rounded p-1 hover:bg-darkHover"
				>
					{isMaximized ? (
						<IoChevronDownOutline size={16} />
					) : (
						<IoChevronUpOutline size={16} />
					)}
				</button>
				<button
					type="button"
					onClick={onClose}
					title="Close Terminal"
					className="rounded p-1 hover:bg-darkHover"
				>
					<IoCloseOutline size={16} />
				</button>
			</div>
		</div>
	);
}

export default TerminalHeader;