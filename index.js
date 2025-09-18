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
        const userTokenMap = new Map(); // To track user IDs for token cleanup

        // 🔹 Fetch FCM tokens
        if (target === "all") {
          const usersSnapshot = await admin
              .firestore()
              .collection("users")
              .get();

          usersSnapshot.docs.forEach((doc) => {
            const userData = doc.data();
            if (userData.fcmToken && userData.fcmToken.trim()) {
              tokens.push(userData.fcmToken);
              userTokenMap.set(userData.fcmToken, doc.id);
            }
          });
        } else if (target === "specific" && specificUser) {
          const userDoc = await admin
              .firestore().collection("users").doc(specificUser).get();
          if (userDoc.exists && userDoc.data().fcmToken) {
            tokens = [userDoc.data().fcmToken];
            userName = userDoc.data().userName || "Unknown User";
            userTokenMap.set(userDoc.data().fcmToken, specificUser);
          }
        }

        // 🔹 No tokens? Fail gracefully
        if (tokens.length === 0) {
          await snap.ref.update({
            status: "failed",
            error: "No valid tokens found",
            userName,
            successCount: 0,
            failureCount: 0,
            targetCount: 0,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
          });
          return;
        }

        console.log(`Processing 
          ${tokens.length} tokens for ${target} notification`);

        // 🔹 Build FCM payload
        const basePayload = {
          notification: {
            title,
            body: message,
          },
          data: {
            type: "alert",
            notificationId: context.params.notificationId,
            timestamp: Date.now().toString(),
          },
          android: {
            priority: "high",
            notification: {
              sound: "default",
              channelId: "default_channel",
            },
          },
          apns: {
            payload: {
              aps: {
                sound: "default",
                badge: 1,
              },
            },
          },
        };

        let totalSuccessCount = 0;
        let totalFailureCount = 0;
        const failedTokens = [];

        // 🔹 Send message(s)
        if (tokens.length === 1) {
          // Single device - use send() method
          try {
            const response = await admin.messaging().send({
              ...basePayload,
              token: tokens[0],
            });
            console.log("Single message sent successfully:", response);
            totalSuccessCount = 1;
          } catch (error) {
            console.error("Error sending single message:", error);
            totalFailureCount = 1;
            failedTokens.push(tokens[0]);

            // Handle invalid token
            if (error.code === "messaging/invalid-registration-token" ||
                error.code === "messaging/registration-token-not-registered") {
              const userId = userTokenMap.get(tokens[0]);
              if (userId) {
                await admin.firestore().collection("users").doc(userId).update({
                  fcmToken: admin.firestore.FieldValue.delete(),
                });
                console.log(`Removed invalid token for user: ${userId}`);
              }
            }
          }
        } else {
          // Multiple devices - use sendEachForMulticast() in batches
          const batchSize = 500; // Firebase limit

          for (let i = 0; i < tokens.length; i += batchSize) {
            const batchTokens = tokens.slice(i, i + batchSize);

            try {
              console.log(`Sending batch 
                ${Math.floor(i / batchSize) + 1} 
                with ${batchTokens.length} tokens`);

              const response = await admin
                  .messaging()
                  .sendEachForMulticast({
                    ...basePayload,
                    tokens: batchTokens, // Use 'tokens' array for multicast
                  });

              console.log(`Batch ${Math.floor(i / batchSize) + 1} 
              - Success: ${response.successCount},
               Failure: ${response.failureCount}`);

              totalSuccessCount += response.successCount;
              totalFailureCount += response.failureCount;

              // 🔹 Handle failed tokens in this batch
              if (response.failureCount > 0) {
                const batchFailedTokens = [];
                response.responses
                    .forEach((resp, idx) => {
                      if (!resp.success) {
                        const failedToken = batchTokens[idx];
                        batchFailedTokens.push(failedToken);
                        failedTokens.push(failedToken);

                        console.log(`Failed token: 
                      ${failedToken.substring(0, 20)}
                      ... - Error: ${resp.error && resp.error.code}`);

                        // Remove invalid tokens immediately
                        if (resp.error &&
                      (resp.error.code ===
                        "messaging/invalid-registration-token" ||
                        resp.error.code ===
                        "messaging/registration-token-not-registered")) {
                          const userId = userTokenMap
                              .get(failedToken);
                          if (userId) {
                            admin
                                .firestore()
                                .collection("users")
                                .doc(userId)
                                .update({
                                  fcmToken: admin
                                      .firestore
                                      .FieldValue.delete(),
                                })
                                .catch(
                                    (err) => console
                                        .error(
                                            "Errorremovinginvalidtoken:", err));
                          }
                        }
                      }
                    });

                console.log(`Batch 
                  ${Math.floor(i / batchSize) + 1} 
                  failed tokens:`, batchFailedTokens.length);
              }
            } catch (batchError) {
              console.error(`Error sending batch 
                ${Math.floor(i / batchSize) + 1}:`, batchError);
              totalFailureCount += batchTokens.length;
              failedTokens.push(...batchTokens);
            }

            // Add small delay between batches to avoid rate limiting
            if (i + batchSize < tokens.length) {
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
          }
        }

        console.log(`Final results - Total Success: 
        ${totalSuccessCount}, Total Failure: ${totalFailureCount}`);

        // 🔹 Update notification status
        const status =
        totalSuccessCount > 0 ? "delivered" : "failed";
        const errorMessage = totalFailureCount > 0 ?
          `${totalFailureCount} 
          delivery failures out of ${tokens.length} total tokens` :
          null;

        await snap.ref.update({
          status: status,
          successCount: totalSuccessCount,
          failureCount: totalFailureCount,
          targetCount: tokens.length,
          error: errorMessage,
          userName,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (error) {
        console.error("Error in notification function:", error);
        await snap.ref.update({
          status: "failed",
          error: error.message,
          successCount: 0,
          failureCount: 0,
          targetCount: 0,
          userName,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    });
