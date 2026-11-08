import SplitterComponent from "@/components/SplitterComponent";
import ConnectionStatusPage from "@/components/connection/ConnectionStatusPage";
import Sidebar from "@/components/sidebar/Sidebar";
import WorkSpace from "@/components/workspace";
import TerminalPanel from "@/components/terminal/TerminalPanel";

import { useAppContext } from "@/context/AppContext";
import { useSocket } from "@/context/SocketContext";
import useFullScreen from "@/hooks/useFullScreen";
import useUserActivity from "@/hooks/useUserActivity";
import { SocketEvent } from "@/types/socket";
import { USER_STATUS } from "@/types/user";

import { useEffect, useState } from "react";
import {
    useLocation,
    useNavigate,
    useParams,
    useSearchParams,
} from "react-router-dom";

function EditorPage() {
    useUserActivity();
    useFullScreen();

    const [isTerminalOpen, setIsTerminalOpen] = useState(false);

    const navigate = useNavigate();
    const { roomId } = useParams();
    const { status, setCurrentUser, currentUser } = useAppContext();
    const { socket } = useSocket();
    const location = useLocation();
    const [searchParams] = useSearchParams();

    useEffect(() => {
        if (currentUser.username.length > 0) return;

        const username =
            location.state?.username || searchParams.get("username");

        if (username === null || username === "") {
            navigate("/", {
                state: { roomId },
            });
        } else if (roomId) {
            const user = { username, roomId };
            setCurrentUser(user);
            socket.emit(SocketEvent.JOIN_REQUEST, user);
        }
    }, [
        currentUser.username,
        location.state?.username,
        searchParams,
        navigate,
        roomId,
        setCurrentUser,
        socket,
    ]);

    if (status === USER_STATUS.CONNECTION_FAILED) {
        return <ConnectionStatusPage />;
    }

    return (
        <SplitterComponent>
            <Sidebar />

            <div className="flex flex-col h-full w-full">

                {/* Optional button for testing */}
                <div className="flex justify-end p-2 border-b">
                    <button
                        onClick={() => setIsTerminalOpen((prev) => !prev)}
                        className="px-3 py-1 rounded bg-gray-800 text-white"
                    >
                        {isTerminalOpen ? "Hide Terminal" : "Show Terminal"}
                    </button>
                </div>

                <div className="flex-1 overflow-hidden">
                    <WorkSpace />
                </div>

                <TerminalPanel
                    isOpen={isTerminalOpen}
                    onClose={() => setIsTerminalOpen(false)}
                />
            </div>
        </SplitterComponent>
    );
}

export default EditorPage;