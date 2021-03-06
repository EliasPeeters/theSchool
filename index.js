const express = require('express');
const mysql = require('mysql');
const util = require('util');
const bodyparser = require('body-parser');
const uuid = require('uuid/v4');
const bcrypt = require('bcrypt');
const cookieparser = require('cookie-parser');
const request = require('request');
var MobileDetect = require('mobile-detect');


const app = express();
const saltRounds = 10;
var loggedInUsers = {};

app.set('view engine', 'ejs');
app.use(cookieparser());
app.use('/assets', express.static('assets'));

//creating mysql connection
const connection = mysql.createConnection({
	host: '192.168.150.60',
	user: 'theSchool',
	password: 'KDEAmUToWJik2MDhQLtoPihF',
	database: 'theSchool'
});

//connecting and checking the connection
connection.connect((err) => {
	if (err) {
		console.log(err)
	} else {
		console.log('Conntected to Database');
	}
});

//function to check if user is logged in
//every rout begins with the login function to check if user is logged in
function logined(req, res) {
	//if not logged in => redirect to login
	if (req.cookies.sessionToken === undefined) {
		res.redirect('/login');
		return false;
	} else if (!(req.cookies.sessionToken in loggedInUsers)) {
		res.clearCookie('sessionToken');
		res.redirect('/login');
		return false;
	}
	return true;
}

//add the urlencodedparser which curls threw the url
const urlencodedparser = bodyparser.urlencoded({extended: false});

//adding new mysql function
//works async
connection.asyncquery = util.promisify(connection.query).bind(connection);


//redirect empty url to login
app.get('/', async function(req, res) {
	res.redirect('/login');
});

//login page
app.get('/login', async function (req, res) {
	//check if error exists
	//like wrong password
	var error = req.query.error;
	//check for mobile
	md = new MobileDetect(req.headers['user-agent']);

	//send desktop or mobile page
	if (md.mobile() === null) {
		res.render('login.ejs', {error: error});
	} else {
		res.render('loginmobil.ejs', {error: error});
	}

});

//login send
app.post('/login', urlencodedparser, async function (req, res) {
	var user = 'SELECT * FROM theSchool.user WHERE username=\'' + req.body.username + '\'';
	//get the user from the query by username
	result = await connection.asyncquery(user);

	if (result[0].userName === undefined) {
		res.redirect('/login?error=Username und/oder Passwort sind falsch');
		return
	}
	//if username does not exist => send back to login with error

	//hash the password again and check with password from db
	if (bcrypt.compareSync(req.body.password, result[0].userPassword)) {
		var uuidForUser = uuid();
		res.cookie('sessionToken', uuidForUser);
		loggedInUsers[uuidForUser] = result[0].userID;
		if (result[0].userTeacher === 1) {
			res.redirect('/profilteacher');
		} else {
			res.redirect('/profil');
		}

	} else {
		//wrong password => send back to login
		res.redirect('/login?error=Username und/oder Passwort sind falsch');
	}
});

//register page
app.get('/register', async function (req, res) {
	var error = req.query.error;
	//check for error
	md = new MobileDetect(req.headers['user-agent']);

	if (md.mobile() === null) {
		res.render('register.ejs', {error: error});
	} else {
		res.render('registermobil.ejs', {error: error});
	}
});

//register send
app.post('/register', urlencodedparser, async function (req, res) {
	//check if username and password arent empty
	if (req.body.username === undefined || req.body.username === '') {
		res.redirect('/register?error=Leerer Username');
		return
	}
	if (req.body.password === undefined || req.body.password === '') {
		res.redirect('/register?error=Leeres Passwort');
		return
	}

	//check if username is not in use
	let checkAvailable = await connection.asyncquery('SELECT * FROM user WHERE userName = \'' + req.body.username + '\'');

	if (checkAvailable.length !== 0) {
		res.redirect('/register?error=Username vergeben');
		return
	}

	//hash the password
	var hash = bcrypt.hashSync(req.body.password, saltRounds);
	//insert new user to db
	const query = 'INSERT INTO `theSchool`.`user` (`userName`, `userPassword`) VALUES (\'' + req.body.username + '\', \'' + hash + '\');';
	await connection.asyncquery(query);
	//redirect user to database
	res.redirect('/login');
});

//logout the user
app.get('/logout', function (req, res) {
	//remove everything from user
	delete loggedInUsers[req.cookies.sessionToken];
	res.clearCookie('sessionToken');
	//send back to login
	res.redirect('/login');
});

app.get('/curl', function (req, res) {
	request.post({url:'https://www.dsbmobile.de/Login.aspx', form: {txtUser: '242421', txtPass: 'Vertretungen'}}, function(err,httpResponse,body){
		//console.log(httpResponse.caseless.dict['set-cookie'][0]);

		request.get({
			url:"https://www.dsbmobile.de/Default.aspx#/menu=0&item=0",
			header: httpResponse.headers
		},function(error, response, body){
			// The full html of the authenticated page
			console.log(body);
		});
	});
});


app.get('/onecourse', urlencodedparser, async function (req, res) {
	if (!logined(req, res)) {
		return;
	}
	if (req.query.id === 'timetable') {
		res.redirect('timetable')
	}
	const user = await connection.asyncquery('SELECT * FROM theSchool.user WHERE userID = ' + loggedInUsers[req.cookies.sessionToken]);
	let courseID = req.query.id;

	//check if user is in course
	let queryUserIsInCourse = 'SELECT * FROM theSchool.user_courses WHERE userID = ' + user[0].userID + ' AND courseID = ' + courseID + ';'
	let resultUserIsInCourse = await connection.asyncquery(queryUserIsInCourse);

	// if user is not in the course => send back to login page
	if (resultUserIsInCourse.length === 0) {
		res.redirect('/profil');
		return;
	}

	//get infos about the course
	let queryCourse = 'SELECT * FROM theSchool.course\n' +
		'    LEFT JOIN theSchool.teacher on teacher.teacherID =course.teacherID\n' +
		'    LEFT JOIN theSchool.subject on subject.subjectID = course.subjectID\n' +
		'    WHERE courseID = ' + req.query.id;

	let resultCourse = await connection.asyncquery(queryCourse);

	//get the utilites for one course
	let queryUtilities ='SELECT * FROM theSchool.utilities WHERE courseID = ' + req.query.id;
	let resultUtilities = await connection.asyncquery(queryUtilities);

	res.render('onecourse.ejs', {course: resultCourse, utilites: resultUtilities});

});

app.get('/profil', async function(req, res){
	if (!logined(req, res)) {
		return
	}
	const user = await connection.asyncquery('SELECT * FROM theSchool.user WHERE userID = ' + loggedInUsers[req.cookies.sessionToken]);

	if (user[0].userTeacher === 1) {
		res.redirect('/profilteacher')
	}

	const courses = await connection.asyncquery('SELECT * FROM user_courses\n' +
		'    left join course on user_courses.courseID = course.courseID\n' +
		'    left join subject on course.subjectID = subject.subjectID\n' +
		'    left join teacher on teacher.teacherID = course.teacherID\n' +
		'where userID = ' + user[0].userID);

	const utilsUnDone = await connection.asyncquery('SELECT * FROM utilities\n' +
		'    LEFT JOIN utilities_user uu on utilities.utilID = uu.utilID\n' +
		'	LEFT JOIN course c on utilities.courseID = c.courseID\n' +
		'	LEFT JOIN subject s on c.subjectID = s.subjectID\n' +
		'WHERE utilities_userDone = 0 AND userID = ' + user[0].userID);

	md = new MobileDetect(req.headers['user-agent']);

	if (md.mobile() === null) {
		res.render('profil.ejs', {courses: courses, username: user[0].userName, utils: utilsUnDone});
	} else {
		res.render('profilmobile.ejs', {courses: courses, username: user[0].userName, utils: utilsUnDone});
	}
});

app.get('/liststeacher', urlencodedparser, async function (req, res) {
	if (!logined(req, res)) {
		return
	}
	const user = await connection.asyncquery('SELECT * FROM theSchool.user WHERE userID = ' + loggedInUsers[req.cookies.sessionToken]);

	if (user[0].userTeacher !== 1) {
		res.redirect('/lists');
	}
	const courses = await connection.asyncquery('SELECT * FROM course\n' +
		'    LEFT JOIN subject on subject.subjectID = course.subjectID\n' +
		'WHERE teacherID = ' + user[0].teacherID);


	var utils = [];
	var progress = [];
	var counter = 0;
	for (let i = 0; i < courses.length; i++) {
		let items = await connection.asyncquery('SELECT * FROM utilities left join course on course.courseID = utilities.courseID WHERE course.courseID=' + courses[i].courseID);
		utils.push(items);
		for (let j = 0; j < items.length; j++) {
			const numberOfStudents = await connection.asyncquery('SELECT utilitiesuserID FROM utilities_user WHERE utilID = ' + items[j].utilID);

			const numberOfStudentsDone = await connection.asyncquery('SELECT utilID FROM utilities_user WHERE utilID = ' + items[j].utilID + ' AND utilities_userDone = 1');
			progress.push({string: numberOfStudentsDone.length + '/' + numberOfStudents.length});
			utils[i][j].doneString = numberOfStudentsDone.length + '/' + numberOfStudents.length
			counter++;
		}
	}
	res.render('teacherlists.ejs', {username: user[0].userName, courses: courses, utils: utils, progress: progress});
});

app.post('/liststeacher', urlencodedparser, async function(req, res) {

	const query = 'INSERT INTO utilities (utilName, utilDescription, courseID) VALUES (\'' + req.body.name + '\', \'' + req.body.description + '\',' + req.query.id+ ')';
	await connection.asyncquery(query);

	const getNewUtilID = await connection.asyncquery('SELECT * FROM utilities WHERE utilName = \'' + req.body.name + '\' AND utilDescription = \''+ req.body.description + '\' AND courseID = ' + req.query.id+ ';');

	const userList = await connection.asyncquery('SELECT * FROM user\n' +
		'    LEFT JOIN user_courses uc on user.userID = uc.userID\n' +
		'WHERE courseID = ' + req.query.id);

	for (let i = 0; i < userList.length; i++) {
		const userGetsTask = await connection.asyncquery('INSERT INTO utilities_user (utilID, userID) VALUES (' + getNewUtilID[getNewUtilID.length-1].utilID  +  ', ' + userList[i].userID + ');');
	}
	

	res.redirect('/liststeacher');
});

app.get('/deleteitem', urlencodedparser, async function (req, res) {
	if (!logined(req, res)) {
		return
	}
	const user = await connection.asyncquery('SELECT * FROM theSchool.user WHERE userID = ' + loggedInUsers[req.cookies.sessionToken]);

	const util = await connection.asyncquery('SELECT * FROM utilities\n' +
		'    LEFT JOIN course on course.courseID = utilities.courseID\n' +
		'    LEFT JOIN teacher on course.teacherID = teacher.teacherID\n' +
		'    LEFT JOIN user u on course.teacherID = u.teacherID\n' +
		'WHERE utilities.utilID = ' + req.query.id);


	if (util[0] === undefined || util[0].userID !== user[0].userID) {
		res.send('Not allowed');
	} else {
		const deleteItem = await connection.asyncquery('DELETE FROM utilities WHERE utilID = ' + util[0].utilID);
		res.redirect('/liststeacher');
	}

});

app.get('/profilteacher', async function (req, res) {
	if (!logined(req, res)) {
		return
	}
	const user = await connection.asyncquery('SELECT * FROM theSchool.user WHERE userID = ' + loggedInUsers[req.cookies.sessionToken]);

	if (user[0].userTeacher !== 1) {
		res.redirect('/profil')
	}
	const courses = await connection.asyncquery('SELECT * FROM course\n' +
		'    LEFT JOIN subject on subject.subjectID = course.subjectID\n' +
		'WHERE teacherID = ' + user[0].teacherID);


	var utils = [];

	for (let i = 0; i < courses.length; i++) {
		let items = await connection.asyncquery('SELECT * FROM utilities left join course on course.courseID = utilities.courseID WHERE course.courseID=' + courses[i].courseID);
		utils.push(items);
	}


	res.render('profilteacher.ejs', {username: user[0].userName, courses: courses, utils: utils});
});

app.get('/onecourseteacher', urlencodedparser, async function (req, res) {
	if (!logined(req, res)) {
		return
	}
	const user = await connection.asyncquery('SELECT * FROM theSchool.user WHERE userID = ' + loggedInUsers[req.cookies.sessionToken]);

	if (user[0].userTeacher !== 1) {
		res.redirect('/profil')
	}


	const checkPermission = await connection.asyncquery('SELECT * FROM course WHERE courseID = ' + req.query.id + ' AND teacherID = ' + user[0].teacherID);

	if (checkPermission[0] === undefined) {
		res.render('errorpage.ejs', {error: 'Dies ist nicht erlaubt'})
		return
	}

	const userList = await connection.asyncquery('SELECT * FROM user\n' +
		'    LEFT JOIN user_courses uc on user.userID = uc.userID\n' +
		'WHERE courseID = ' + req.query.id);


	const course = await connection.asyncquery('SELECT * FROM course\n' +
		'    LEFT JOIN subject s on course.subjectID = s.subjectID\n' +
		'WHERE courseID = ' + req.query.id);

	res.render('onecourseteacher.ejs', {username: user[0].userName, userList: userList, course: course});

});

app.get('/oneutilteacher', urlencodedparser, async function (req, res) {
	if (!logined(req, res)) {
		return
	}
	const user = await connection.asyncquery('SELECT * FROM theSchool.user WHERE userID = ' + loggedInUsers[req.cookies.sessionToken]);

	if (user[0].userTeacher !== 1) {
		res.redirect('/profil')
	}

	const course = await connection.asyncquery('SELECT * FROM utilities\n' +
		'    LEFT JOIN course c on utilities.courseID = c.courseID\n' +
		'    LEFT JOIN subject s on c.subjectID = s.subjectID\n' +
		'WHERE utilID = '+ req.query.utilid + ' \n' +
		'LIMIT 1\n');

	const students = await connection.asyncquery('SELECT * FROM utilities\n' +
		'    LEFT JOIN user_courses uc on utilities.courseID = uc.courseID\n' +
		'    LEFT JOIN user u on uc.userID = u.userID\n' +
		'WHERE utilID = ' + req.query.utilid);

	const doneResult = await connection.asyncquery('SELECT * FROM utilities_user WHERE utilID = ' + req.query.utilid +  ' ORDER BY utilitiesuserID')

	let done = [];
	for (let i = 0; i < doneResult.length; i++) {
		if (doneResult[i].utilities_userDone === 1) {
			done.push('X')
		} else {
			done.push(' ')
		}

	}

	res.render('oneutilteacher.ejs', {username: user[0].userName, students: students, done: done, course: course[0]})
});

function timetableOptimizer(inputDay) {
	var i = 1;
	var lessonCounter = 0;
	var outputDay = [];
	var empty = {subjectName: '-', coursesID: 'timetable'};
	if (inputDay.length === 0) {
		return [empty, empty, empty, empty, empty, empty, empty, empty, empty, empty];
	}

	while (i-1 < inputDay[inputDay.length-1].ctLesson) {
		if (inputDay[lessonCounter].ctLesson === i) {
			outputDay.push(inputDay[lessonCounter]);
			lessonCounter++;
		} else {
			outputDay.push({subjectName: '-', coursesID: 'timetable'});
		}
		i++;
	}
	const length = 10-outputDay.length;
	for (let ii = 0; ii < length; ii++) {
		outputDay.push({subjectName: '-', coursesID: 'timetable'});
	}

	return outputDay;
}

app.get('/lists', urlencodedparser, async function (req, res) {
	if (!logined(req, res)) {
		return
	}
	const user = await connection.asyncquery('SELECT * FROM theSchool.user WHERE userID = ' + loggedInUsers[req.cookies.sessionToken]);

	const courses = await connection.asyncquery('SELECT * FROM course LEFT JOIN subject on course.subjectID = subject.subjectID LEFT JOIN user_courses on user_courses.courseID = course.courseID WHERE userID = ' + user[0].userID);


	var utils = [];

	for (let i = 0; i < courses.length; i++) {
		let items = await connection.asyncquery('SELECT * FROM utilities\n' +
			'    left join course on course.courseID = utilities.courseID\n' +
			'    LEFT JOIN subject on subject.subjectID = course.subjectID\n' +
			'    LEFT JOIN utilities_user uu on utilities.utilID = uu.utilID\n' +
			'WHERE course.courseID=' +  + courses[i].courseID + ' AND userID = ' + user[0].userID);
		utils.push(items);
		if (items[i] !== undefined) {
			for (let j = 0; j < items[i].length; j++) {
				if (items[i][j].utilities_userDone === 1) {
					utils[i][j].color = 'green';
				} else {
					utils[i][j].color = 'red';
				}
			}
		}
	}
	for (let i = 0; i < utils.length; i++) {
		for (let j = 0; j < utils[i].length; j++) {
			if (utils[i][j].utilities_userDone === 1) {
				utils[i][j].color = 'green';
				utils[i][j].button = 'Nicht erledigt';
			} else {
				utils[i][j].color = 'red';
				utils[i][j].button = 'Erledigt';
			}
		}
	}
	md = new MobileDetect(req.headers['user-agent']);
	if (md.mobile() === null) {
		res.render('lists.ejs', {username: user[0].userName, courses: courses, utils: utils});
	} else {
		res.render('listsmobile.ejs', {username: user[0].userName, courses: courses, utils: utils});
	}
});

app.get('/utilFinished', urlencodedparser, async function (req, res) {
	if (!logined(req, res)) {
		return
	}
	const user = await connection.asyncquery('SELECT * FROM theSchool.user WHERE userID = ' + loggedInUsers[req.cookies.sessionToken]);

	const util = await connection.asyncquery('SELECT * FROM utilities\n' +
		'    LEFT JOIN course c on utilities.courseID = c.courseID\n' +
		'    LEFT JOIN user_courses uc on utilities.courseID = uc.courseID\n' +
		'    LEFT JOIN user u on uc.userID = u.userID\n' +
		'WHERE utilID = ' + req.query.id + ' AND u.userID = ' + user[0].userID);

	if (util[0] === undefined) {
		res.send('Not allowed');
	} else {
		const doneOfNotDone = await connection.asyncquery('SELECT * FROM utilities_user WHERE utilID = ' + req.query.id + ' AND userID =' + user[0].userID);
		console.log(doneOfNotDone)
		if (doneOfNotDone[0].utilities_userDone === 0) {
			const updateUtil = await connection.asyncquery('UPDATE utilities_user SET utilities_userDone=1 WHERE utilID = ' +  req.query.id + ' AND userID=' + user[0].userID);
		} else {
			const updateUtil = await connection.asyncquery('UPDATE utilities_user SET utilities_userDone=0 WHERE utilID = ' +  req.query.id + ' AND userID=' + user[0].userID);
		}
		res.redirect('/lists');
	}

});

app.get('/timetable',urlencodedparser, async function (req, res) {
	if (!logined(req, res)) {
		return
	}
	const user = await connection.asyncquery('SELECT * FROM theSchool.user WHERE userID = ' + loggedInUsers[req.cookies.sessionToken]);

	const mondayDB = await connection.asyncquery('SELECT * FROM theSchool.course\n' +
		'    LEFT JOIN theSchool.subject on course.subjectID = subject.subjectID\n' +
		'    LEFT JOIN theSchool.user_courses on user_courses.courseID = course.courseID\n' +
		'    LEFT JOIN theSchool.courses_times ON courses_times.coursesID = course.courseID\n' +
		'WHERE ctWeekday = 1 AND userID = ' + user[0].userID + ' ORDER BY ctLesson');
	const tuesdayDB = await connection.asyncquery('SELECT * FROM theSchool.course\n' +
		'    LEFT JOIN theSchool.subject on course.subjectID = subject.subjectID\n' +
		'    LEFT JOIN theSchool.user_courses on user_courses.courseID = course.courseID\n' +
		'    LEFT JOIN theSchool.courses_times ON courses_times.coursesID = course.courseID\n' +
		'WHERE ctWeekday = 2 AND userID = ' + user[0].userID + ' ORDER BY ctLesson');
	const wednesdayDB = await connection.asyncquery('SELECT * FROM theSchool.course\n' +
		'    LEFT JOIN theSchool.subject on course.subjectID = subject.subjectID\n' +
		'    LEFT JOIN theSchool.user_courses on user_courses.courseID = course.courseID\n' +
		'    LEFT JOIN theSchool.courses_times ON courses_times.coursesID = course.courseID\n' +
		'WHERE ctWeekday = 3 AND userID = ' + user[0].userID + ' ORDER BY ctLesson');
	const thursdayDB = await connection.asyncquery('SELECT * FROM theSchool.course\n' +
		'    LEFT JOIN theSchool.subject on course.subjectID = subject.subjectID\n' +
		'    LEFT JOIN theSchool.user_courses on user_courses.courseID = course.courseID\n' +
		'    LEFT JOIN theSchool.courses_times ON courses_times.coursesID = course.courseID\n' +
		'WHERE ctWeekday = 4 AND userID = ' + user[0].userID + ' ORDER BY ctLesson');
	const fridayDB = await connection.asyncquery('SELECT * FROM theSchool.course\n' +
		'    LEFT JOIN theSchool.subject on course.subjectID = subject.subjectID\n' +
		'    LEFT JOIN theSchool.user_courses on user_courses.courseID = course.courseID\n' +
		'    LEFT JOIN theSchool.courses_times ON courses_times.coursesID = course.courseID\n' +
		'WHERE ctWeekday = 5 AND userID = ' + user[0].userID + ' ORDER BY ctLesson');

	var monday = timetableOptimizer(mondayDB);
	var tuesday = timetableOptimizer(tuesdayDB);
	var wednesday = timetableOptimizer(wednesdayDB);
	var thursday = timetableOptimizer(thursdayDB);
	var friday = timetableOptimizer(fridayDB);
	md = new MobileDetect(req.headers['user-agent']);

	console.log(thursday);
	console.log(thursdayDB);
	if (md.mobile() === null) {
		res.render('timetable.ejs', {monday: monday, tuesday: tuesday, wednesday: wednesday, thursday: thursday, friday: friday});
	} else {
		res.render('timetablemobile.ejs', {monday: monday, tuesday: tuesday, wednesday: wednesday, thursday: thursday, friday: friday});
	}

});

app.get('/teacher', async function (req, res) {
	const teacher = await connection.asyncquery('SELECT * FROM theSchool.teacher');
	md = new MobileDetect(req.headers['user-agent']);

	if (md.mobile() === null) {
		res.render('teacher.ejs', {teacher: teacher});
	} else {
		res.render('teachermobile.ejs', {teacher: teacher});
	}

});

app.get('/teacherteacher', async function (req, res) {
	const teacher = await connection.asyncquery('SELECT * FROM theSchool.teacher');
	res.render('teacherteacher.ejs', {teacher: teacher});
});




app.get('/message', async function (req, res) {
	if (!logined(req, res)) {
		return
	}
	const user = await connection.asyncquery('SELECT * FROM theSchool.user WHERE userID = ' + loggedInUsers[req.cookies.sessionToken]);

	const messages = await connection.asyncquery('SELECT DATE_FORMAT(messageTime, \'%e/%c/%Y %H:%i\') messageTime, messageID, messageContent, messageFromUserID, messageToUserID, messageRead, messageButton, userName FROM messages\n' +
		'    LEFT JOIN user on messageFromUserID = userID\n' +
		'WHERE messageToUserID = ' + user[0].userID + ' order by messageTime DESC');
	md = new MobileDetect(req.headers['user-agent']);
	if (md.mobile() === null) {
		res.render('message.ejs', {messages: messages});
	} else {
		res.render('messagemobile.ejs', {messages: messages});
	}

});

app.get('/newmessage', async function (req, res) {
	if (!logined(req, res)) {
		return
	}
	const user = await connection.asyncquery('SELECT * FROM theSchool.user WHERE userID = ' + loggedInUsers[req.cookies.sessionToken]);
	let username;
	if (req.query.name !== undefined) {
		username = req.query.name;
	} else {
		 username = ''
	}
	let error;
	if (req.query.error !== undefined) {
		error = req.query.error;
	} else {
		error = ''
	}
	console.log(error)

	md = new MobileDetect(req.headers['user-agent']);
	if (md.mobile() === null) {
		res.render('newmessage.ejs', {username: username, error: error})
	} else {
		res.render('newmessagemobile.ejs', {username: username, error: error})
	}


});

app.post('/newmessage', urlencodedparser, async function (req, res) {
	if (!logined(req, res)) {
		return
	}
	console.log(req.body.message);
	const user = await connection.asyncquery('SELECT * FROM theSchool.user WHERE userID = ' + loggedInUsers[req.cookies.sessionToken]);

	const userNameTO = await connection.asyncquery('SELECT userID from user where userName = \''+req.body.username + '\'');

	if (userNameTO[0] === undefined) {
		res.redirect('/newmessage?error=Den Benutzer gibt es nicht');
		return
	}

	if (req.body.message === undefined || req.body.message === '') {
		res.redirect('/newmessage?error=Die Nachricht hat keinen Inhalt');
		return;
	}
	try {
		const query = await connection.asyncquery('INSERT INTO messages (messageContent, messageTime, messageFromUserID, messageToUserID) VALUES (\'' + req.body.message + '\', now(), ' + user[0].userID + ', ' + userNameTO[0].userID + ')')
	} catch (e) {
		res.redirect('/newmessage?error=Die Nachricht ist ungültig');
	}

	res.redirect('/message');
});

app.get('/messageteacher', async function (req, res) {
	if (!logined(req, res)) {
		return
	}
	const user = await connection.asyncquery('SELECT * FROM theSchool.user WHERE userID = ' + loggedInUsers[req.cookies.sessionToken]);

	const messages = await connection.asyncquery('SELECT DATE_FORMAT(messageTime, \'%e/%c/%Y %H:%i\') messageTime, messageID, messageContent, messageFromUserID, messageToUserID, messageRead, messageButton, userName FROM messages\n' +
		'    LEFT JOIN user on messageFromUserID = userID\n' +
		'WHERE messageToUserID = ' + user[0].userID + ' order by messageTime DESC');

	res.render('messageteacher.ejs', {messages: messages});
});

app.get('/newmessageteacher', async function (req, res) {
	if (!logined(req, res)) {
		return
	}
	const user = await connection.asyncquery('SELECT * FROM theSchool.user WHERE userID = ' + loggedInUsers[req.cookies.sessionToken]);
	let username;
	if (req.query.name !== undefined) {
		username = req.query.name;
	} else {
		username = ''
	}
	let error;
	if (req.query.error !== undefined) {
		error = req.query.error;
	} else {
		error = ''
	}
	console.log(error)

	res.render('newmessageteacher.ejs', {username: username, error: error})
});

app.post('/newmessageteacher', urlencodedparser, async function (req, res) {
	if (!logined(req, res)) {
		return
	}
	const user = await connection.asyncquery('SELECT * FROM theSchool.user WHERE userID = ' + loggedInUsers[req.cookies.sessionToken]);

	const userNameTO = await connection.asyncquery('SELECT userID from user where userName = \''+req.body.username + '\'');
	console.log(userNameTO);

	if (userNameTO[0] === undefined) {
		res.redirect('/newmessageteacher?error=Den Benutzer gibt es nicht');
		return
	}
	if (req.body.message === undefined || req.body.message === '') {
		res.redirect('/newmessageteacher?error=Die Nachricht hat keinen Inhalt');
		return;
	}
	const query = await connection.asyncquery('INSERT INTO messages (messageContent, messageTime, messageFromUserID, messageToUserID) VALUES (\'' + req.body.message + '\', now(), ' + user[0].userID + ', ' + userNameTO[0].userID + ')')
	res.redirect('/messageteacher');
});

app.get('/messageread', async function(req, res) {
	if (!logined(req, res)) {
		return
	}
	const user = await connection.asyncquery('SELECT * FROM theSchool.user WHERE userID = ' + loggedInUsers[req.cookies.sessionToken]);

	const updateMessage = await connection.asyncquery('UPDATE messages \n' +
		'SET messageRead = \'white\', messageButton=\'none\'\n' +
		'WHERE messageID = ' + req.query.id);
	res.redirect('/message');
});

app.get('/messagereadteacher', async function(req, res) {
	if (!logined(req, res)) {
		return
	}
	const user = await connection.asyncquery('SELECT * FROM theSchool.user WHERE userID = ' + loggedInUsers[req.cookies.sessionToken]);

	const updateMessage = await connection.asyncquery('UPDATE messages \n' +
		'SET messageRead = \'white\', messageButton=\'none\'\n' +
		'WHERE messageID = ' + req.query.id);
	res.redirect('/messageteacher');
});

app.get('*', function (req, res) {
	res.render('errorpage.ejs', {error: 'Die von ihnen angeforderte Seite existiert nicht'})
});

app.listen(3000, function(){
	console.log('Running on 3000');
});
