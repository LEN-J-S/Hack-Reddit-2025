import { Devvit, useState, useInterval } from '@devvit/public-api';

// Enable Redis, media, and Reddit API capabilities
Devvit.configure({ 
  redis: true,
  media: true,
  redditAPI: true
});

// Define a constant for the leaderboard key to ensure consistency
const LEADERBOARD_KEY = 'reflex_game_scores_v2';

Devvit.addCustomPostType({
  name: 'Check Your Reflexes',
  render: (context) => {
    const { redis, reddit } = context;
    const [screen, setScreen] = useState<'menu' | 'game' | 'gameOver' | 'leaderboard' | 'howToPlay'>('menu');
    const [tutorialPage, setTutorialPage] = useState(1);
    const [score, setScore] = useState(0);
    const [lives, setLives] = useState(3);
    const [roundsCompleted, setRoundsCompleted] = useState(0);
    const [correctImage, setCorrectImage] = useState('');
    const [imageOptions, setImageOptions] = useState<string[]>([]);
    const [timeLeft, setTimeLeft] = useState(60); // 1-minute game time
    const [gameActive, setGameActive] = useState(false);
    const [roundTimer, setRoundTimer] = useState(3); // Initial round timer
    const [roundTimeTotal, setRoundTimeTotal] = useState(3); // Track total time for current round
    const [backgroundColor, setBackgroundColor] = useState('#31017c'); // Initial background color
    const [leaderboard, setLeaderboard] = useState<Array<{member: string, score: number}>>([]);
    const [username, setUsername] = useState('');

    // Get current username - using the newer getCurrentUsername method for better performance
    useState(async () => {
      try {
        // Use the more direct method to get just the username
        const user = await reddit.getCurrentUsername();
        console.log(`Retrieved username: ${user}`);
        setUsername(user || 'Anonymous');
      } catch (error) {
        console.error(`Error getting username: ${error}`);
        setUsername('Anonymous');
      }
    });

    // Fetch leaderboard data
    const fetchLeaderboard = async () => {
      try {
        console.log('Fetching leaderboard data...');
        
        // First, check if the key exists and has any members
        const count = await redis.zCard(LEADERBOARD_KEY);
        console.log(`Number of entries in leaderboard: ${count}`);
        
        if (count === 0) {
          console.log('Leaderboard is empty');
          setLeaderboard([]);
          return [];
        }
        
        // Try a simpler approach first
        const allMembers = await redis.zRange(LEADERBOARD_KEY, 0, -1);
        console.log(`All members: ${JSON.stringify(allMembers)}`);
        
        // Now get the scores
        const topScores = await redis.zRange(LEADERBOARD_KEY, 0, 6, { 
          reverse: true,
          withScores: true 
        });
        
        console.log(`Raw leaderboard data: ${JSON.stringify(topScores)}`);
        
        // Format the data to match the expected structure
        const formattedScores = topScores.map(item => ({
          member: item.member,
          score: Number(item.score)
        }));
        
        console.log(`Formatted leaderboard data: ${JSON.stringify(formattedScores)}`);
        setLeaderboard(formattedScores);
        return formattedScores;
      } catch (error) {
        console.error(`Error fetching leaderboard: ${error}`);
        return [];
      }
    };

    // Save score to leaderboard
    const saveScore = async () => {
      if (username && score > 0) {
        console.log(`Attempting to save score ${score} for user ${username}`);
        
        try {
          // Get user's current high score
          const currentScore = await redis.zScore(LEADERBOARD_KEY, username);
          console.log(`Current score for ${username}: ${currentScore}`);
          
          // Only update if new score is higher than existing score
          if (!currentScore || score > currentScore) {
            console.log(`Saving new high score ${score} for ${username}`);
            await redis.zAdd(LEADERBOARD_KEY, { member: username, score });
            
            // Verify the score was saved - add a small delay to ensure Redis has time to process
            await new Promise(resolve => setTimeout(resolve, 100));
            const verifyScore = await redis.zScore(LEADERBOARD_KEY, username);
            console.log(`Verified score for ${username}: ${verifyScore}`);
            
            // Try a simpler approach to fetch all scores
            const allScores = await redis.zRange(LEADERBOARD_KEY, 0, -1);
            console.log(`Simple scores list: ${JSON.stringify(allScores)}`);
            
            // Then try with scores
            const allScoresWithScores = await redis.zRange(LEADERBOARD_KEY, 0, -1, { withScores: true });
            console.log(`All scores in leaderboard: ${JSON.stringify(allScoresWithScores)}`);
            
            console.log(`Score saved successfully`);
          } else {
            console.log(`Not saving score as it's not higher than current score`);
          }
          
          // Refresh leaderboard data
          await fetchLeaderboard();
        } catch (error) {
          console.error(`Error saving score: ${error}`);
        }
      } else {
        console.log(`Not saving score - username: ${username}, score: ${score}`);
      }
    };

    const shapes = ["Circle", "Hexagon", "Square", "Star", "Triangle"];
    const colors = ["Violet", "Orange", "Blue", "Yellow", "Red", "Green"];
    
    // Function to generate random color
    const getRandomColor = () => {
      return `#${Math.floor(Math.random()*16777215).toString(16)}`;
    };

    // Function to determine round time based on round number
    const getRoundTime = (roundNumber: number) => {
      if (roundNumber < 10) return 3;           // First 10 rounds: 3 seconds
      if (roundNumber < 25) return 2;           // Next 15 rounds: 2 seconds
      if (roundNumber < 40) return 1.5;         // Next 15 rounds: 1.5 seconds
      if (roundNumber < 50) return 1;           // Next 10 rounds: 1 second
      if (roundNumber < 60) return 2;           // Next 10 rounds: 2 seconds
      return 1.5;                               // All subsequent rounds: 1.5 seconds
    };

    const startNewRound = () => {
      if (!gameActive) return;

      // Set the round timer based on current round
      const newRoundTime = getRoundTime(roundsCompleted);
      setRoundTimer(newRoundTime);
      setRoundTimeTotal(newRoundTime);

      // Change background color after round 35
      if (roundsCompleted >= 35) {
        setBackgroundColor(getRandomColor());
      }

      // Ensure unique shape-color combinations
      let availableShapes = [...shapes];
      let availableColors = [...colors];

      const randomShape = availableShapes.splice(Math.floor(Math.random() * availableShapes.length), 1)[0];
      const randomColor = availableColors.splice(Math.floor(Math.random() * availableColors.length), 1)[0];
      const correctImageName = `${randomColor} ${randomShape}.png`;

      setCorrectImage(correctImageName);

      // Generate distractors
      let randomImages = [correctImageName];

      if (roundsCompleted >= 18) {
        // After 20 rounds: Two same shapes as correct choice but different colors, 
        // and two different shapes with different colors
        
        // Add another color with the same shape
        const anotherColor = availableColors.splice(Math.floor(Math.random() * availableColors.length), 1)[0];
        const sameShapeDiffColor = `${anotherColor} ${randomShape}.png`;
        randomImages.push(sameShapeDiffColor);
        
        // Add two different shapes with different colors
        for (let i = 0; i < 2; i++) {
          const differentShape = availableShapes.splice(Math.floor(Math.random() * availableShapes.length), 1)[0];
          const differentColor = availableColors.splice(Math.floor(Math.random() * availableColors.length), 1)[0];
          const newImage = `${differentColor} ${differentShape}.png`;
          randomImages.push(newImage);
        }
      } else {
        // Before 20 rounds: Random distractors
        while (randomImages.length < 4) {
          const shape = availableShapes.length > 0 
            ? availableShapes.splice(Math.floor(Math.random() * availableShapes.length), 1)[0]
            : shapes[Math.floor(Math.random() * shapes.length)];
          
          const color = availableColors.length > 0
            ? availableColors.splice(Math.floor(Math.random() * availableColors.length), 1)[0]
            : colors[Math.floor(Math.random() * colors.length)];
          
          const newImage = `${color} ${shape}.png`;
          if (!randomImages.includes(newImage)) {
            randomImages.push(newImage);
          }
        }
      }

      // Shuffle images
      setImageOptions(randomImages.sort(() => Math.random() - 0.5));
    };

    const handleImageSelect = (image: string) => {
      if (!gameActive) return;

      if (image === correctImage) {
        setScore(score + 10);
      } else {
        setLives(lives - 1);
        if (lives - 1 === 0) {
          endGame();
          return;
        }
      }

      setRoundsCompleted(roundsCompleted + 1);
      startNewRound();
    };

    const endGame = async () => {
      console.log('Game ended, saving score...');
      setGameActive(false);
      setScreen('gameOver');
      await saveScore(); // Save score when game ends
      console.log('Score saved, game over screen displayed');
    };

    // Game timer
    const gameTimer = useInterval(() => {
      if (timeLeft > 0 && gameActive) {
        setTimeLeft(timeLeft - 1);
      } else if (timeLeft === 0 && gameActive) {
        endGame();
      }
    }, 1000);
    
    // Round timer - FIXED to handle decimal values properly
    const roundTimerInterval = useInterval(() => {
      if (roundTimer > 0 && gameActive) {
        setRoundTimer(Math.max(0, roundTimer - 1)); // Prevent negative values
      } else if (Math.round(roundTimer * 10) / 10 === 0 && gameActive) { // Round to nearest 0.1
        // Time's up for this round
        setLives(lives - 1);
        if (lives - 1 === 0) {
          endGame();
          return;
        }
        setRoundsCompleted(roundsCompleted + 1);
        startNewRound();
      }
    }, 1000);

    // Background color change timer
    const colorChangeInterval = useInterval(() => {
      if (gameActive) {
        if (roundsCompleted >= 50) {
          // After 50 rounds, change background color every second with same shape choices
          setBackgroundColor(getRandomColor());
        } else if (roundsCompleted >= 35) {
          // After 35 rounds, change background color every second with different shapes
          setBackgroundColor(getRandomColor());
        }
      }
    }, 1000);
    
    gameTimer.start();
    roundTimerInterval.start();
    colorChangeInterval.start();

    if (correctImage === '' && gameActive) {
      startNewRound();
    }

    const renderMenuScreen = () => (
      <blocks height="tall">
        <vstack alignment="center middle" width="100%" height="100%" backgroundColor="#31017c">
          <spacer size="small" />
          <image url="intro_logo.png" imageWidth={300} imageHeight={300} resizeMode="fit" />
          <spacer size="xsmall" />
          <vstack gap="medium" width="80%" alignment="center">
            <button appearance="primary" onPress={() => {
              setScreen('game');
              setGameActive(true);
              setScore(0);
              setLives(3);
              setRoundsCompleted(0);
              setTimeLeft(60);
              setBackgroundColor('#31017c');
              startNewRound();
            }}>Play Game</button>
            <button appearance="secondary" onPress={() => {
              setScreen('howToPlay');
              setTutorialPage(1);
            }}>How to Play</button>
            <button appearance="secondary" onPress={async () => {
              console.log("Leaderboard button pressed");
              await fetchLeaderboard();
              setScreen('leaderboard');
            }}>Leaderboard</button>
          </vstack>
          <spacer size="large" />
        </vstack>
      </blocks>
    );

    const renderGameScreen = () => {
      // Determine which difficulty image to show based on round number
      let difficultyImage = "E.png"; // Default for rounds 1-20
      
      if (roundsCompleted >= 51) {
        difficultyImage = "X.png";
      } else if (roundsCompleted >= 36) {
        difficultyImage = "H.png";
      } else if (roundsCompleted >= 21) {
        difficultyImage = "M.png";
      }
      
      return (
        <blocks height="tall">
          <zstack width="100%" height="100%">
            <vstack width="100%" height="100%" backgroundColor={backgroundColor} />
            <vstack alignment="center middle" padding="small" width="100%" height="100%" gap="medium">
              <hstack alignment="center middle" width="100%" padding="medium" gap="large">
                <text size="xlarge" weight="bold" color="rgba(255, 255, 255, 0.9)">Rounds: {roundsCompleted.toString()}</text>
                <hstack gap="small" alignment="center middle">
                  {Array.from({ length: lives }).map((_, index) => (
                    <text key={index} size="xlarge" color="red">❤️</text>
                  ))}
                </hstack>
                <text size="xlarge" weight="bold" color="rgba(255, 255, 255, 0.9)">Score: {score}</text>
              </hstack>
              
              <hstack alignment="center" width="100%" gap="medium" padding="xsmall">
                <vstack alignment="center" backgroundColor="rgba(0, 0, 0, 0.6)" padding="small" cornerRadius="large" width="40%">
                  <text size="large" weight="bold" color="#ffffff">{correctImage.replace('.png', '').toUpperCase()}</text>
                </vstack>
                <vstack alignment="center" backgroundColor="rgba(0, 0, 0, 0.6)" padding="small" cornerRadius="large" width="20%">
                  <text size="medium" color="rgba(255, 255, 255, 0.7)">GAME</text>
                  <text size="large" weight="bold" color={timeLeft < 10 ? "#ff5555" : "#ffffff"}>
                    {Math.floor(timeLeft / 60)}:{timeLeft % 60 < 10 ? `0${timeLeft % 60}` : timeLeft % 60}
                  </text>
                </vstack>
                <vstack alignment="center" backgroundColor="rgba(0, 0, 0, 0.6)" padding="small" cornerRadius="large" width="20%">
                  <text size="medium" color="rgba(255, 255, 255, 0.7)">ROUND</text>
                  <text size="large" weight="bold" color={roundTimer < 2 ? "#ff5555" : "#ffffff"}>
                    {roundTimer}s
                  </text>
                  <hstack width="100%" height="4px" backgroundColor="rgba(255,255,255,0.3)">
                    <hstack width={`${(roundTimer/roundTimeTotal)*100}%`} height="4px" backgroundColor="#ffffff" />
                  </hstack>
                </vstack>
              </hstack>

              <vstack gap="medium" width="100%" alignment="center">
                {[0, 1].map(row => (
                  <hstack key={row} gap="medium" width="100%" alignment="center middle">
                    {imageOptions.slice(row * 2, row * 2 + 2).map((img, idx) => (
                      <vstack 
                        key={idx} 
                        alignment="center middle" 
                        padding="none"
                        backgroundColor="transparent" 
                        onPress={() => handleImageSelect(img)} 
                        width="40%"
                      >
                        <image url={img} imageWidth={100} imageHeight={100} resizeMode="fit" />
                      </vstack>
                    ))}
                  </hstack>
                ))}
              </vstack>
              
              {/* Difficulty level indicator at bottom */}
              <vstack alignment="center" width="100%" padding="small">
                <image url={difficultyImage} imageWidth={100} imageHeight={100} resizeMode="fit" />
              </vstack>
            </vstack>
          </zstack>
        </blocks>
      );
    };

    const renderGameOverScreen = () => {
      // Determine level based on rounds completed
      let levelNumber = 1;   // Default image for < 15 rounds
      
      if (roundsCompleted >= 85) {
        levelNumber = 8;
      } else if (roundsCompleted >= 75) {
        levelNumber = 7;
      } else if (roundsCompleted >= 65) {
        levelNumber = 6;
      } else if (roundsCompleted >= 50) {
        levelNumber = 5;
      } else if (roundsCompleted >= 40) {
        levelNumber = 4;
      } else if (roundsCompleted >= 30) {
        levelNumber = 3;
      } else if (roundsCompleted >= 20) {
        levelNumber = 2;
      } else if (roundsCompleted >= 15) {
        levelNumber = 1;
      }
      
      return (
        <blocks height="tall">
          <vstack alignment="center middle" width="100%" height="100%" backgroundColor="#31017c" gap="medium">
            <text size="xxlarge" weight="bold" color="#ffffff">LEVEL ACHIEVED!</text>
            <image url={`${levelNumber}.png`} imageWidth={200} imageHeight={200} />
            <text size="large" color="rgba(255, 255, 255, 0.8)">Final Score: {score}</text>
            
            <hstack gap="medium" alignment="center middle">
              <vstack alignment="center">
                <text size="medium" color="rgba(255, 255, 255, 0.7)">ROUNDS</text>
                <text size="large" weight="bold" color="#ffffff">{roundsCompleted}</text>
              </vstack>
              <vstack alignment="center">
                <text size="medium" color="rgba(255, 255, 255, 0.7)">TIME TAKEN</text>
                <text size="large" weight="bold" color="#ffffff">{60 - timeLeft}s</text>
              </vstack>
            </hstack>
            
            <button appearance="primary" onPress={() => {
              setScore(0);
              setLives(3);
              setRoundsCompleted(0);
              setTimeLeft(60);
              setGameActive(true);
              setBackgroundColor('#31017c');
              setScreen('game');
              startNewRound();
            }}>Play Again</button>
            <button appearance="secondary" onPress={async () => {
              console.log("View Leaderboard button pressed from game over screen");
              await fetchLeaderboard();
              setScreen('leaderboard');
            }}>View Leaderboard</button>
            <button appearance="secondary" onPress={() => setScreen('menu')}>Back to Menu</button>
          </vstack>
        </blocks>
      );
    };

    const renderLeaderboardScreen = () => (
      <blocks height="tall">
        <vstack alignment="center middle" width="100%" height="100%" backgroundColor="#31017c" gap="medium">
          <text size="xxlarge" weight="bold" color="#ffffff">TOP PLAYERS</text>
          
          <vstack width="80%" gap="small" padding="medium" backgroundColor="rgba(0,0,0,0.3)" cornerRadius="medium">
            <hstack width="100%" padding="small" backgroundColor="rgba(255,255,255,0.1)">
              <text width="15%" color="#ffffff" weight="bold">Rank</text>
              <text width="55%" color="#ffffff" weight="bold">Player</text>
              <text width="30%" color="#ffffff" weight="bold" alignment="end">Score</text>
            </hstack>
            
            {leaderboard.length > 0 ? (
              leaderboard.map((entry, index) => (
                <hstack key={index} width="100%" padding="small" backgroundColor={username === entry.member ? "rgba(255,255,255,0.2)" : "transparent"}>
                  <text width="15%" color="#ffffff">{index + 1}</text>
                  <text width="55%" color="#ffffff">{entry.member}</text>
                  <text width="30%" color="#ffffff" alignment="end">{entry.score}</text>
                </hstack>
              ))
            ) : (
              <text color="rgba(255,255,255,0.7)" alignment="center">No scores yet. Be the first!</text>
            )}
          </vstack>
          
          <button appearance="secondary" onPress={() => {
            console.log("Back to Menu button pressed from leaderboard");
            setScreen('menu');
          }}>Back to Menu</button>
        </vstack>
      </blocks>
    );

    // New render function for the How to Play screen
    const renderHowToPlayScreen = () => (
      <blocks height="tall">
        <vstack alignment="center middle" width="100%" height="100%" backgroundColor="#31017c" gap="medium">
          <text size="xxlarge" weight="bold" color="#ffffff">HOW TO PLAY</text>
          
          {/* Show the current tutorial image */}
          <image 
            url={`h${tutorialPage === 0 ? '' : tutorialPage}.png`} 
            imageWidth={300} 
            imageHeight={300} 
            resizeMode="fit" 
          />
          
          <hstack gap="medium">
            {tutorialPage > 1 && (
              <button appearance="secondary" onPress={() => setTutorialPage(tutorialPage - 1)}>
                Previous
              </button>
            )}
            
            {tutorialPage < 3 ? (
              <button appearance="primary" onPress={() => setTutorialPage(tutorialPage + 1)}>
                Next
              </button>
            ) : (
              <button appearance="primary" onPress={() => setScreen('menu')}>
                Back to Menu
              </button>
            )}
          </hstack>
        </vstack>
      </blocks>
    );

    // Update the return statement to include the new screen
    if (screen === 'menu') return renderMenuScreen();
    if (screen === 'game') return renderGameScreen();
    if (screen === 'leaderboard') return renderLeaderboardScreen();
    if (screen === 'howToPlay') return renderHowToPlayScreen();
    return renderGameOverScreen();
  }
});

export default Devvit;