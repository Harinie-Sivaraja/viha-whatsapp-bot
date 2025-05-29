const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const express = require('express');
const { Client, MessageMedia, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');

// Create Express app for web interface
const app = express();
const PORT = process.env.PORT || 3000;

let qrCodeData = '';
let isReady = false;

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'your-mongodb-connection-string-here';

// Initialize MongoDB connection
let store;

async function initializeMongoDB() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Connected to MongoDB');
        
        // Create the MongoStore for session management
        store = new MongoStore({ mongoose: mongoose });
        console.log('✅ MongoDB session store initialized');
        
        return store;
    } catch (error) {
        console.error('❌ MongoDB connection failed:', error);
        throw error;
    }
}

// Serve QR code page
app.get('/', (req, res) => {
    if (isReady) {
        res.send(`
            <html>
                <body style="text-align: center; font-family: Arial;">
                    <h1>✅ WhatsApp Bot is Ready!</h1>
                    <p>Your VihaCandlesAndGiftings bot is active and ready to receive messages.</p>
                    <div style="margin-top: 20px; padding: 20px; background: #f0f8ff; border-radius: 10px;">
                        <h3>🔄 Bot Status: ONLINE</h3>
                        <p>Session stored in MongoDB Atlas</p>
                    </div>
                </body>
            </html>
        `);
    } else if (qrCodeData) {
        res.send(`
            <html>
                <body style="text-align: center; font-family: Arial;">
                    <h1>📱 Scan QR Code to Connect WhatsApp</h1>
                    <div id="qr-container">
                        <img src="${qrCodeData}" alt="QR Code" style="max-width: 400px;">
                    </div>
                    <p>Scan this QR code with your WhatsApp to connect the bot</p>
                    <div style="margin-top: 20px; padding: 15px; background: #fff3cd; border-radius: 10px;">
                        <small>💾 Using MongoDB for persistent session storage</small>
                    </div>
                    <script>
                        // Auto-refresh every 5 seconds
                        setTimeout(() => location.reload(), 5000);
                    </script>
                </body>
            </html>
        `);
    } else {
        res.send(`
            <html>
                <body style="text-align: center; font-family: Arial;">
                    <h1>🔄 Starting WhatsApp Bot...</h1>
                    <p>Connecting to MongoDB and initializing session...</p>
                    <div style="margin-top: 20px; padding: 15px; background: #e7f3ff; border-radius: 10px;">
                        <small>⚡ This may take 30-60 seconds on first startup</small>
                    </div>
                    <script>
                        // Auto-refresh every 3 seconds
                        setTimeout(() => location.reload(), 3000);
                    </script>
                </body>
            </html>
        `);
    }
});

// Health check endpoint for monitoring
app.get('/health', (req, res) => {
    res.json({
        status: isReady ? 'ready' : 'initializing',
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

// Start Express server
app.listen(PORT, () => {
    console.log(`Web interface running on port ${PORT}`);
    console.log(`Health check available at /health`);
});

// Self-ping to prevent Render from sleeping (for free tier)
if (process.env.NODE_ENV === 'production') {
    const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    
    setInterval(() => {
        const https = require('https');
        const http = require('http');
        const client = RENDER_URL.startsWith('https://') ? https : http;
        
        client.get(`${RENDER_URL}/health`, (res) => {
            console.log(`Keep-alive ping: ${res.statusCode}`);
        }).on('error', (err) => {
            console.log('Keep-alive error:', err.message);
        });
    }, 14 * 60 * 1000); // Every 14 minutes
}

// Initialize WhatsApp Client with MongoDB session store
async function initializeWhatsAppClient() {
    try {
        console.log('🔄 Initializing MongoDB connection...');
        const mongoStore = await initializeMongoDB();
        
        console.log('🔄 Creating WhatsApp client with MongoDB session...');
        
        // WhatsApp Client Setup with MongoDB session store using RemoteAuth
        const client = new Client({
            authStrategy: new RemoteAuth({
                store: mongoStore,
                backupSyncIntervalMs: 300000 // Backup every 5 minutes
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding'
                ]
            }
        });

        client.on('qr', async (qr) => {
            console.log('📱 QR Code received, generating web QR...');
            // Generate QR for terminal
            qrcode.generate(qr, { small: true });
            
            // Generate QR for web interface
            try {
                qrCodeData = await QRCode.toDataURL(qr);
                console.log('✅ QR Code available on web interface');
            } catch (err) {
                console.error('Error generating web QR:', err);
            }
        });

        client.on('ready', () => {
            console.log('✅ VihaCandlesAndGiftings Bot is ready!');
            console.log('💾 Session saved to MongoDB Atlas');
            isReady = true;
            qrCodeData = ''; // Clear QR code
        });

        client.on('authenticated', () => {
            console.log('✅ Authentication successful - Session stored in MongoDB');
            isReady = true;
        });

        client.on('auth_failure', msg => {
            console.error('❌ Authentication failed', msg);
            isReady = false;
            qrCodeData = '';
        });

        client.on('disconnected', (reason) => {
            console.log('❌ Client disconnected:', reason);
            isReady = false;
            // The session is still saved in MongoDB, so it will reconnect automatically
        });

        // RemoteAuth events
        client.on('remote_session_saved', () => {
            console.log('💾 Remote session saved to MongoDB');
        });

        // Add your existing message handling code here
        setupMessageHandlers(client);

        console.log('🚀 Initializing WhatsApp client...');
        client.initialize();

        return client;

    } catch (error) {
        console.error('❌ Failed to initialize WhatsApp client:', error);
        throw error;
    }
}

// Your existing message handling logic
function setupMessageHandlers(client) {
    const userState = {}; // Stores each user's state
    const humanOverride = {}; // Tracks users where human agent has taken over

    // Enhanced message templates with improved welcome message
    const messages = {
        welcome: `🎁 *Welcome to VihaCandlesAndGiftings!* 🎁

To serve you better, we have *5 quick questions* for you.

Are you looking for return gifts for your function?

━━━━━━━━━━━━━━━━━━━
1️⃣ → Yes, I need return gifts
2️⃣ → No
━━━━━━━━━━━━━━━━━━━

Reply with *1* or *2*`,

        timing: `⏰ *When do you need the return gifts delivered?*

━━━━━━━━━━━━━━━━━━━
1️⃣ → Within 1 week
2️⃣ → Within 2 weeks  
3️⃣ → Within 3 weeks
4️⃣ → More than 3 weeks
━━━━━━━━━━━━━━━━━━━

Reply with *1, 2, 3* or *4*`,

        budget: `💰 *What's your budget range?*

━━━━━━━━━━━━━━━━━━━
1️⃣ → Under ₹50
2️⃣ → ₹51 - ₹100
3️⃣ → ₹101 - ₹150
4️⃣ → ₹151 - ₹200
5️⃣ → More than ₹200
━━━━━━━━━━━━━━━━━━━

Reply with *1, 2, 3, 4* or *5*`,

        quantity: `🧮 *How many pieces do you need?*

━━━━━━━━━━━━━━━━━━━
1️⃣ → Less than 30 pieces
2️⃣ → 30 - 50 pieces
3️⃣ → 51 - 100 pieces
4️⃣ → 101 - 150 pieces
5️⃣ → More than 150 pieces
━━━━━━━━━━━━━━━━━━━

Reply with *1, 2, 3, 4* or *5*`,

        location: `📍 *Your delivery location please (City/Area)?*`,

        notInterested: `Then, Shall we know why you have contacted us? Do you have any return gifts requirement? If so, you will get

🎁 Get *FLAT ₹250 DISCOUNT* on your first purchase with us on 50 pieces MOQ.

This offer is valid only till tomorrow

If interested in above offer, please reply us. Our team will talk to you within 30 mins.`,

        humanAgent: `We understand you may need personalized assistance. Our team will reach out to you shortly to help with your return gift requirements.

Thank you for your patience! 🙏`
    };

    // Error messages with attempt tracking
    const errorMessages = {
        start: `❌ Please reply with *1* or *2*`,
        function_time: `❌ Please reply with *1, 2, 3* or *4*`,
        budget: `❌ Please reply with *1, 2, 3, 4* or *5*`,
        piece_count: `❌ Please reply with *1, 2, 3, 4* or *5*`
    };

    // Function to send images for under ₹50 items
    const sendUnder50Images = async (chatId) => {
        try {
            const fs = require('fs');
            const path = require('path');
            
            // Step 1: Send summary as separate message
            const detailedSummary = generateDetailedSummary(userState[chatId]);
            await client.sendMessage(chatId, detailedSummary);
            
            // Small delay between messages
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Step 2: Send introductory message as separate message
            await client.sendMessage(chatId, `🎁 *Here are our return gifts under ₹50:*`);
            
            // Small delay before images
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Path to your images folder - relative path for cloud deployment
            const imagesFolder = path.join(__dirname, 'Gifts_Under50');
            
            // Check if folder exists
            if (!fs.existsSync(imagesFolder)) {
                console.log('Images folder not found, sending fallback message');
                await client.sendMessage(chatId, `🎁 *Return Gifts Under ₹50*

We have various beautiful return gift options under ₹50. Our team will contact you with the complete catalog and images.

If you are interested in any of these products, please let us know.

Our team will give you complete details. 😊`);
                return;
            }
            
            // Read all files from the images folder
            const imageFiles = fs.readdirSync(imagesFolder).filter(file => {
                const ext = path.extname(file).toLowerCase();
                return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
            });

            if (imageFiles.length === 0) {
                console.log('No images found in the folder');
                await client.sendMessage(chatId, `If you are interested in any of these products, please let us know.

Our team will give you complete details. 😊`);
                return;
            }

            // Step 3: Send each image with a small delay to avoid rate limiting
            for (let i = 0; i < imageFiles.length; i++) {
                const imagePath = path.join(imagesFolder, imageFiles[i]);
                
                try {
                    const media = MessageMedia.fromFilePath(imagePath);
                    await client.sendMessage(chatId, media);
                    
                    // Longer delay between images (1.5 seconds) to avoid WhatsApp rate limiting
                    await new Promise(resolve => setTimeout(resolve, 1500));
                } catch (error) {
                    console.error(`Error sending image ${imageFiles[i]}:`, error);
                }
            }

            // Step 4: Send final message after all images as separate message
            const finalMessage = `If you are interested in any of these products, please let us know.

Our team will give you complete details. 😊`;

            await client.sendMessage(chatId, finalMessage);
            
        } catch (error) {
            console.error('Error in sendUnder50Images:', error);
            // Fallback message if image sending fails
            const detailedSummary = generateDetailedSummary(userState[chatId]);
            await client.sendMessage(chatId, detailedSummary);
            
            await client.sendMessage(chatId, `🎁 *Return Gifts Under ₹50*

We have various beautiful return gift options under ₹50. Our team will contact you with the complete catalog and images.

If you are interested in any of these products, please let us know.

Our team will give you complete details. 😊`);
        }
    };

    // Function to send images for under ₹100 items
    const sendUnder100Images = async (chatId) => {
        try {
            const fs = require('fs');
            const path = require('path');
            
            // Step 1: Send summary as separate message
            const detailedSummary = generateDetailedSummary(userState[chatId]);
            await client.sendMessage(chatId, detailedSummary);
            
            // Small delay between messages
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Step 2: Send introductory message as separate message
            await client.sendMessage(chatId, `🎁 *Here are our return gifts under ₹100:*`);
            
            // Small delay before images
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Path to your images folder - relative path for cloud deployment
            const imagesFolder = path.join(__dirname, 'Gifts_Under100');
            
            // Check if folder exists
            if (!fs.existsSync(imagesFolder)) {
                console.log('Under100 images folder not found, sending fallback message');
                await client.sendMessage(chatId, `🎁 *Return Gifts Under ₹100*

We have various beautiful return gift options under ₹100. Our team will contact you with the complete catalog and images.

If you are interested in any of these products, please let us know.

Our team will give you complete details. 😊`);
                return;
            }
            
            // Read all files from the images folder
            const imageFiles = fs.readdirSync(imagesFolder).filter(file => {
                const ext = path.extname(file).toLowerCase();
                return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
            });

            if (imageFiles.length === 0) {
                console.log('No images found in the under 100 folder');
                await client.sendMessage(chatId, `If you are interested in any of these products, please let us know.

Our team will give you complete details. 😊`);
                return;
            }

            // Step 3: Send each image with a small delay to avoid rate limiting
            for (let i = 0; i < imageFiles.length; i++) {
                const imagePath = path.join(imagesFolder, imageFiles[i]);
                
                try {
                    const media = MessageMedia.fromFilePath(imagePath);
                    await client.sendMessage(chatId, media);
                    
                    // Longer delay between images (2.seconds) to avoid WhatsApp rate limiting
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } catch (error) {
                    console.error(`Error sending image ${imageFiles[i]}:`, error);
                }
            }

            // Step 4: Send final message after all images as separate message
            const finalMessage = `If you are interested in any of these products, please let us know.

Our team will give you complete details. 😊`;

            await client.sendMessage(chatId, finalMessage);
            
        } catch (error) {
            console.error('Error in sendUnder100Images:', error);
            // Fallback message if image sending fails
            const detailedSummary = generateDetailedSummary(userState[chatId]);
            await client.sendMessage(chatId, detailedSummary);
            
            await client.sendMessage(chatId, `🎁 *Return Gifts Under ₹100*

We have various beautiful return gift options under ₹100. Our team will contact you with the complete catalog and images.

If you are interested in any of these products, please let us know.

Our team will give you complete details. 😊`);
        }
    };

    // Function to generate detailed customer summary
    const generateDetailedSummary = (userStateData) => {
        const timingOptions = {
            '1': 'Within 1 week',
            '2': 'Within 2 weeks',
            '3': 'Within 3 weeks',
            '4': 'After 3 weeks'
        };

        const budgetOptions = {
            '1': 'Under ₹50',
            '2': '₹51 - ₹100',
            '3': '₹101 - ₹150',
            '4': '₹151 - ₹200',
            '5': 'More than ₹200'
        };

        const quantityOptions = {
            '1': 'Less than 30 pieces',
            '2': '30 - 50 pieces',
            '3': '51 - 100 pieces',
            '4': '101 - 150 pieces',
            '5': 'More than 150 pieces'
        };

        return `*Your Requirements:*
• Budget: ${budgetOptions[userStateData.budget] || 'Not specified'}
• Quantity: ${quantityOptions[userStateData.quantity] || 'Not specified'}
• Function Timing: ${timingOptions[userStateData.timing] || 'Not specified'}
• Delivery Location: ${userStateData.location || 'Not specified'}`;
    };

    // Simplified function to check if a message is from a human agent
    const isHumanAgent = (message) => {
        // Method 1: Check if message contains the human agent marker
        if (message.body.includes('###')) {
            return true;
        }
        
        // Method 2: Check if message is a reply to a previous message (human agents often reply)
        if (message.hasQuotedMsg) {
            return true;
        }
        
        return false;
    };

    client.on('message', async message => {
        try {
            // Ignore messages from groups and status updates
            if (message.from.includes('@g.us') || message.from.includes('status@broadcast')) {
                return;
            }

            const chatId = message.from;

            // Check if message is from human agent (sent using the bot's WhatsApp)
            if (message.fromMe && isHumanAgent(message)) {
                console.log(`Human agent has taken over conversation with ${chatId}`);
                humanOverride[chatId] = true;
                // Clear user state to prevent bot from continuing automated flow
                if (userState[chatId]) {
                    userState[chatId].step = 'human_override';
                }
                return;
            }

            // Ignore messages sent by the bot itself (automated responses)
            if (message.fromMe) {
                return;
            }

            console.log(`Received message from ${chatId}: ${message.body}`);

            // Check if human agent has taken over this conversation
            if (humanOverride[chatId]) {
                console.log(`Human agent has control of ${chatId}. Bot will not respond.`);
                return;
            }

            const text = message.body.toLowerCase().trim();

            // Check if user has completed the conversation flow
            if (userState[chatId] && userState[chatId].step === 'completed') {
                console.log(`User ${chatId} has completed conversation. Bot will not respond to: ${message.body}`);
                return;
            }

            // Check if user is new (first time messaging)
            if (!userState[chatId]) {
                userState[chatId] = { 
                    step: 'start',
                    errorCount: {
                        start: 0,
                        function_time: 0,
                        budget: 0,
                        piece_count: 0
                    }
                };
                await client.sendMessage(chatId, messages.welcome);
                console.log('Welcome message sent to new user successfully');
                return;
            }

            const state = userState[chatId];

            // Handle invalid input with attempt tracking
            const handleInvalidInput = async (currentStep) => {
                // Increment error count for current step
                state.errorCount[currentStep]++;
                
                // Check if user has exceeded 3 attempts
                if (state.errorCount[currentStep] >= 3) {
                    console.log(`User ${chatId} exceeded 3 wrong attempts at step: ${currentStep}`);
                    userState[chatId].step = 'completed';
                    await client.sendMessage(chatId, messages.humanAgent);
                    return true; // Return true to indicate conversation ended
                } else {
                    // Send error message for first and second wrong attempts
                    await client.sendMessage(chatId, errorMessages[currentStep]);
                    return false; // Return false to continue conversation
                }
            };

            // Step 1: Are you looking for return gifts?
            if (state.step === 'start') {
                if (text === 'yes' || text === '1') {
                    userState[chatId].step = 'function_time';
                    await client.sendMessage(chatId, messages.timing);
                    return;
                } else if (text === 'no' || text === '2') {
                    userState[chatId].step = 'completed';
                    await client.sendMessage(chatId, messages.notInterested);
                    return;
                } else {
                    const conversationEnded = await handleInvalidInput('start');
                    if (conversationEnded) return;
                }
            }

            // Step 2: When is your function?
            if (state.step === 'function_time') {
                const validTimings = ['1', '2', '3', '4'];
                
                if (validTimings.includes(text)) {
                    userState[chatId].step = 'budget';
                    userState[chatId].timing = text;
                    await client.sendMessage(chatId, messages.budget);
                    return;
                } else {
                    const conversationEnded = await handleInvalidInput('function_time');
                    if (conversationEnded) return;
                }
            }

            // Step 3: Budget Range
            if (state.step === 'budget') {
                const validBudgets = ['1', '2', '3', '4', '5'];
                
                if (validBudgets.includes(text)) {
                    userState[chatId].step = 'piece_count';
                    userState[chatId].budget = text;
                    await client.sendMessage(chatId, messages.quantity);
                    return;
                } else {
                    const conversationEnded = await handleInvalidInput('budget');
                    if (conversationEnded) return;
                }
            }

            // Step 4: Quantity
            if (state.step === 'piece_count') {
                const validQuantities = ['1', '2', '3', '4', '5'];
                
                if (validQuantities.includes(text)) {
                    userState[chatId].quantity = text;
                    userState[chatId].step = 'location';
                    await client.sendMessage(chatId, messages.location);
                    return;
                } else {
                    const conversationEnded = await handleInvalidInput('piece_count');
                    if (conversationEnded) return;
                }
            }

            // Step 5: Delivery Location → Send images or team response based on budget
            if (state.step === 'location') {
                // Accept any text as location (no validation needed)
                userState[chatId].location = message.body.trim();
                
                // Check budget and send appropriate response
                if (userState[chatId].budget === '1') {
                    // Send images for under ₹50 items
                    await sendUnder50Images(chatId);
                } else if (userState[chatId].budget === '2') {
                    // Send images for under ₹100 items (₹51-₹100)
                    await sendUnder100Images(chatId);
                } else {
                    // For other budgets, send detailed summary first, then simple message
                    const detailedSummary = generateDetailedSummary(userState[chatId]);
                    await client.sendMessage(chatId, detailedSummary);
                    
                    // Small delay between messages
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    const finalMessage = `✅ *Thank you for your interest!*

Our team will talk to you. 😊`;

                    await client.sendMessage(chatId, finalMessage);
                }
                
                userState[chatId].step = 'completed';
                return;
            }

            // This should not be reached if logic is correct
            console.log(`Unexpected state for user ${chatId}: ${JSON.stringify(state)}`);

        } catch (error) {
            console.error('Error handling message:', error);
            // Only send error message if conversation is not completed and human hasn't taken over
            if ((!userState[message.from] || userState[message.from].step !== 'completed') && !humanOverride[message.from]) {
                await client.sendMessage(message.from, 'Sorry, something went wrong. Please try again or type "hello" to restart.');
            }
        }
    });

    // Enhanced command to manually reset human override and handle human agent takeover
    client.on('message', async message => {
        if (message.fromMe) {
            const chatId = message.from;
            
            // Check for human agent marker (###)
            if (message.body.includes('###')) {
                console.log(`Human agent marker detected for ${chatId}. Bot will stop responding.`);
                humanOverride[chatId] = true;
                if (userState[chatId]) {
                    userState[chatId].step = 'human_override';
                }
                return;
            }
            
            // Reset bot command
            if (message.body === 'RESET_BOT' && message.hasQuotedMsg) {
                try {
                    const quotedMsg = await message.getQuotedMessage();
                    const targetChatId = quotedMsg.from;
                    
                    delete humanOverride[targetChatId];
                    delete userState[targetChatId];
                    console.log(`Bot re-enabled for ${targetChatId}`);
                    
                    // Optionally send confirmation
                    await client.sendMessage(targetChatId, 'Bot has been re-enabled for this chat.');
                } catch (error) {
                    console.error('Error resetting bot:', error);
                }
            }
        }
    });
}

// Start the application
console.log('🚀 Starting WhatsApp bot with MongoDB session storage...');
initializeWhatsAppClient().catch(error => {
    console.error('❌ Failed to start bot:', error);
    process.exit(1);
});