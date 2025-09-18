# React2RN Push Notifications (Firebase Functions)

![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)  
![Firebase](https://img.shields.io/badge/Firebase-Functions-orange)  
![License](https://img.shields.io/badge/license-MIT-blue)  

Firebase Cloud Functions to send push notifications from a **React web admin app** to a **React Native mobile app** using **Firebase Cloud Messaging (FCM)**.  

---

## 🚀 Features
- Send notifications to **all users** or a **specific user**.  
- Handles invalid / expired FCM tokens and cleans them up from Firestore.  
- Supports **batch sending** with error handling for large user bases.  
- Updates Firestore `notifications` collection with delivery status (`delivered`, `failed`, counts, errors).  
- Works with both **Android** and **iOS**.  

---

## 📂 Firestore Structure
- `users/{userId}` → stores `fcmToken` and `userName`.  
- `notifications/{notificationId}` → triggers this function when a new notification is created.  

---

## 🔧 Setup

1. Install dependencies:
   ```bash
   npm install
   ```
   
   or with Yarn:
   ```bash
   yarn install --legacy-peer-deps
   ```

2. Deploy the Cloud Function:
   ```bash
   firebase deploy --only functions
   ```

---

## 📌 Example Usage

Create a new document in Firestore under the `notifications` collection:

```json
{
  "title": "Hello from Web!",
  "message": "This is a test push 🚀",
  "target": "all", 
  "specificUser": "user123" 
}
```

### Example 1: Send to all users
```json
{
  "title": "System Update",
  "message": "All services will be down for maintenance at 2 AM.",
  "target": "all"
}
```

### Example 2: Send to a specific user
```json
{
  "title": "Personal Alert",
  "message": "Your subscription is about to expire!",
  "target": "specific",
  "specificUser": "user_ABC123"
}
```

The function will:
1. Fetch tokens from `users` collection.
2. Send the notification(s).
3. Update the `notifications` document with:

```json
{
  "status": "delivered",
  "successCount": 10,
  "failureCount": 0,
  "targetCount": 10,
  "userName": "All Users",
  "timestamp": "serverTimestamp"
}
```

---

## 📜 License

MIT License © 2025
