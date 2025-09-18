const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

exports.sendNotificationsToApp = functions.firestore
    .document("notifications/{notificationId}")
    .onCreate(async (snap, context) => {
      const notification = snap.data();
      const {title, message, target, specificUser} = notification;
      let userName = "All Users";

      try {
        let tokens = [];

        // 🔹 Fetch FCM tokens
        if (target === "all") {
          const usersSnapshot = await admin
              .firestore()
              .collection("users")
              .get();
          tokens = usersSnapshot.docs
              .map((doc) => doc.data().fcmToken)
              .filter((token) => token);
        } else if (target === "specific" && specificUser) {
          const userDoc = await admin
              .firestore().collection("users").doc(specificUser).get();
          if (userDoc.exists && userDoc.data().fcmToken) {
            tokens = [userDoc.data().fcmToken];
            userName = userDoc.data().userName || "Unknown User";
          }
        }

        // 🔹 No tokens? Fail gracefully
        if (tokens.length === 0) {
          await snap.ref.update({
            status: "failed",
            error: "No valid tokens found",
            userName,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
          });
          return;
        }

        // 🔹 Build FCM payload
        const payload = {
          notification: {
            title,
            body: message,
          },
          data: {
            type: "alert",
            notificationId: context.params.notificationId,
          },
          android: {
            priority: "high",
            notification: {
              sound: "default",
              channelId: "default_channel",
            },
          },
        };

        let response;

        // 🔹 Send message(s)
        if (tokens.length === 1) {
          response = await admin.messaging().send({
            ...payload,
            token: tokens[0],
          });
          console.log("Message sent:", response);

          await snap.ref.update({
            status: response ? "delivered" : "failed",
            successCount: response ? 1 : 0,
            failureCount: response ? 0 : 1,
            userName,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
          });
        } else {
          response = await admin
              .messaging().sendMulticast({
                ...payload,
                tokens,
              });
          console.log(`Sent to ${response.successCount} 
            devices, failed ${response.failureCount}`);

          // 🔹 Clean up invalid tokens
          if (response.failureCount > 0) {
            const failedTokens = [];
            response.responses.
                forEach((resp, idx) => {
                  if (!resp.success) {
                    failedTokens.push(tokens[idx]);
                  }
                });

            if (failedTokens.length > 0) {
              const batch = admin.firestore().batch();
              const snapshot = await admin
                  .firestore()
                  .collection("users")
                  .where("fcmToken", "in", failedTokens)
                  .get();
              snapshot
                  .forEach((doc) => batch.
                      update(doc.ref, {fcmToken: null}));
              await batch.commit();
              console.log("Cleaned invalid tokens:", failedTokens);
            }
          }

          await snap.ref.update({
            status: "delivered",
            successCount: response.successCount,
            failureCount: response.failureCount,
            userName,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      } catch (error) {
        console.error("Error sending notification:", error);
        await snap.ref.update({
          status: "failed",
          error: error.message,
          userName,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    });
