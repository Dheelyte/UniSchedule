export const logActivity = async (action) => {
    try {
        await fetch("http://127.0.0.1:8000/activity/log", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                action,
                timestamp: new Date().toISOString(),
            }),
        });
    } catch (error) {
        console.error("Activity log failed", error);
    }
};