const pool = require("../config/database");


class State {
    constructor(id, name) {
        this.id = id;
        this.name = name;
    }
    export() {
        return this.name;
    }
}

class Player {
    constructor(id,name,state) {
        this.id = id;
        this.name = name;
        this.state= state;
    }
    export() {
        let player = new Player();
        player.name = this.name;
        player.state = this.state.export();
        return player;
    }
}

class Game {
    constructor(id,state,player,opponents) {
        this.id = id;
        this.state = state;
        this.player = player;
        this.opponents = opponents || [];
    }
    export() {
        let game = new Game();
        game.id = this.id;
        game.state = this.state.export();
        if (this.player)
            game.player = this.player.export();
        game.opponents = this.opponents.map(o => o.export());
        return game;
    }    

    // No verifications, we assume they were already made
    // This is mostly an auxiliary method
    static async fillPlayersOfGame(playerId,game) {
        try {
            let [dbPlayers] = await pool.query(`Select * from user 
            inner join user_game on ug_user_id = usr_id
             inner join user_game_state on ugst_id = ug_state_id
            where ug_game_id=?`, [game.id]);
            for (let dbPlayer of dbPlayers) {
                let player = new Player(dbPlayer.usr_id,dbPlayer.usr_name,
                            new State(dbPlayer.ugst_id,dbPlayer.ugst_state) );
                if (dbPlayer.usr_id == playerId) game.player = player;
                else game.opponents.push(player);
            }
            return {status:200, result: game};
        } catch (err) {
            console.log(err);
            return { status: 500, result: err };
        }
    }
    
    static async getGamesWaitingForPlayers(playerId) {
        try {
            let [dbGames] =
                await pool.query(`Select * from game 
                    inner join game_state on gm_state_id = gst_id
                    where gst_state = 'Waiting'`);
            let games = [];
            for (let dbGame of dbGames) {
                let game = new Game(dbGame.gm_id,new State(dbGame.gst_id,dbGame.gst_state));
                let result = await this.fillPlayersOfGame(playerId,game);
                if (result.status != 200) {
                    return result;
                }
                game = result.result;
                games.push(game);
            }
            return { status: 200, result: games} ;
        } catch (err) {
            console.log(err);
            return { status: 500, result: err };
        }
    }    

    static async getPlayerActiveGame(id) {
        try {
            let [dbGames] =
                await pool.query(`Select * from game 
                    inner join user_game on gm_id = ug_game_id 
                    inner join game_state on gm_state_id = gst_id
                    where ug_user_id=? and gst_state IN ('Waiting','Started')`, [id]);
            if (dbGames.length==0)
                return {status:404, result:{msg:"No active game found for player"}};
            let dbGame = dbGames[0];
            let game = new Game(dbGame.gm_id,new State(dbGame.gst_id,dbGame.gst_state));
            let result = await this.fillPlayersOfGame(id,game);
            if (result.status != 200) {
                return result;
            }
            game = result.result;
        return { status: 200, result: game} ;
        } catch (err) {
            console.log(err);
            return { status: 500, result: err };
        }
    }

    // A game is always created with one user
    // No verifications. We assume the following were already made (because of authentication):
    //  - Id exists and user exists
    //  - User does not have an active game
    static async create(userId) {
        try {
            // create the game
            let [result] = await pool.query(`Insert into game (gm_state_id) values (?)`, [1]);
            let gameId = result.insertId;
            // add the user to the game
            await pool.query(`Insert into user_game (ug_user_id,ug_game_id,ug_state_id) values (?,?,?)`,
                 [userId, gameId, 1]);
            return {status:200, result: {msg: "You created a new game."}};
        } catch (err) {
            console.log(err);
            return { status: 500, result: err };
        }
    }


    // No verification needed since we considered that it was already made 
    // This should have a verification from every player
    // - If only one player it would cancel
    // - Else, each player would only change his state to cancel
    // - When the last player run the cancel the game would cancel
    // (no need to be this complex since we will only use this to invalidate games)
    static async cancel(gameId) {
        try {
            await pool.query(`Update game set gm_state_id=? where gm_id = ?`,
                    [4,gameId]);
            return {status:200, result: {msg: "Game canceled."}};
        } catch (err) {
            console.log(err);
            return { status: 500, result: err };
        }
    }



    // ---- These methods assume a two players game (we need it at this point) --------
          

    // We consider the following verifications were already made (because of authentication):
    //  - Id exists and user exists
    //  - User does not have an active game
    // We still need to check if the game exist and if it is waiting for players
    static async join(userId, gameId) {
        try {
            let [dbGames] = await pool.query(`Select * from game where gm_id=?`, [gameId]);
            if (dbGames.length==0)
                return {status:404, result:{msg:"Game not found"}};
            let dbGame = dbGames[0];
            if (dbGame.gm_state_id != 1) 
                return {status:400, result:{msg:"Game not waiting for other players"}};
            
            // Randomly determine who starts    
            let myTurn = (Math.random() < 0.5);

            // add the user to the game, if it is my turn I start with state 2 (Playing)
            await pool.query(`Insert into user_game (ug_user_id,ug_game_id,ug_state_id) values (?,?,?)`,
                 [userId, gameId, (myTurn)?2:1]);
            // If this player is not the first we need to change the state of the opponent to 2
            if (!myTurn) {
                // Getting opponents (only 1 exists)
                let [dbPlayers] = await pool.query(`Select * from user_game 
                    where ug_game_id=? and ug_user_id!=?`, [gameId, userId]);
                let player2 = dbPlayers[0];
                await pool.query(`Update user_game set ug_state_id=? where ug_id = ?`,
                            [2,player2.ug_id]);
            }
            await pool.query(`Update game set gm_state_id=? where gm_id = ?`,[2,gameId]);

            return {status:200, result: {msg: "You joined the game."}};
        } catch (err) {
            console.log(err);
            return { status: 500, result: err };
        }
    }

}

module.exports = Game;