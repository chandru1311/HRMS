import { query } from "../config/db.js";
import { sendNotificationOnce } from "../services/notificationService.js";

export const getNotifications = async (req, res) => {
  try {
    const userId = req.user?.id || req.query.userId;
    if (!userId) {
      return res.status(400).json({ error: "User ID is required." });
    }

    const result = await query(
      "SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500",
      [userId]
    );

    const formatted = result.rows.map(r => ({
      id: r.id,
      _id: r.id,
      userId: r.user_id,
      title: r.title,
      message: r.message,
      type: r.type || "info",
      read: Boolean(r.read),
      link: r.link || "",
      createdAt: r.created_at,
      created_at: r.created_at,
      timestamp: r.created_at
    }));

    res.json(formatted);
  } catch (err) {
    console.error("getNotifications error:", err);
    res.status(500).json({ error: "Failed to fetch notifications." });
  }
};

export const createNotification = async (req, res) => {
  try {
    const { userId, title, message, type = "info", link = "", activityType = null, entityId = null } = req.body;
    if (!userId || !title || !message) {
      return res.status(400).json({ error: "userId, title, and message are required." });
    }

    const io = req.app?.get("io");
    const result = await sendNotificationOnce({
      userId,
      title,
      message,
      type,
      link,
      io,
      activityType,
      entityId
    });

    if (!result) {
      return res.status(500).json({ error: "Failed to create notification." });
    }

    if (result.duplicate) {
      return res.json({
        ...result,
        _id: result.id,
        type,
        read: false,
        link
      });
    }

    return res.status(201).json(result);
  } catch (err) {
    console.error("createNotification error:", err);
    res.status(500).json({ error: "Failed to create notification." });
  }
};

export const markNotificationAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(
      "UPDATE notifications SET read = true WHERE id = $1 RETURNING *",
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Notification not found." });
    }
    res.json({ success: true, notification: result.rows[0] });
  } catch (err) {
    console.error("markNotificationAsRead error:", err);
    res.status(500).json({ error: "Failed to mark notification as read." });
  }
};

export const markAllNotificationsAsRead = async (req, res) => {
  try {
    const userId = req.user?.id || req.body.userId;
    if (!userId) {
      return res.status(400).json({ error: "User ID is required." });
    }
    await query("UPDATE notifications SET read = true WHERE user_id = $1", [userId]);
    res.json({ success: true, message: "All notifications marked as read." });
  } catch (err) {
    console.error("markAllNotificationsAsRead error:", err);
    res.status(500).json({ error: "Failed to mark all notifications as read." });
  }
};

export const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    await query("DELETE FROM notifications WHERE id = $1", [id]);
    res.json({ success: true, message: "Notification deleted successfully." });
  } catch (err) {
    console.error("deleteNotification error:", err);
    res.status(500).json({ error: "Failed to delete notification." });
  }
};
