const jwt = require("jsonwebtoken");
const User = require("../models/userModel");
const Role = require("../models/roleModel");
const bouncer = require("../helper/bruteprotect");
const Product = require("../models/productModel");
const { Op } = require("sequelize");
const path = require("path");
const util = require('util');
const asyncVerify = util.promisify(jwt.verify);
const {
  isEmailExist,
  issueToken,
  hashPassword,
  isEmailVerified,
  isPasswordCorrect,
  isTokenValid,
  issueLongtimeToken,
} = require("../helper/user");
const { handleError } = require("../helper/handleError");
const { validationResult } = require("express-validator");
const { sendEmail } = require("../helper/send_email");
const { removeEmptyPair } = require("../helper/reusable");

exports.registerUser = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg });
  }
  try {
    const { first_name, last_name, email, password } = req.body;
    const token = jwt.sign({ email: email }, process.env.SECRET);
    const mailOptions = {
      from: process.env.EMAIL,
      to: email,
      subject: "TestRxMD Account Confirmation Link",
      text: "Follow the link to confirm your email!",
      html: `${process.env.CONFIRM_LINK}?verifyToken=${token}`,
    };
    if (await isEmailExist(email)) {
      if (await isEmailVerified(email)) {
        handleError("User already exists with this email", 400);
      }
      //this should be her other wise unhandled error will raise
      else {
        const hashedPassword = await hashPassword(password);
        User.update(
          {
            first_name,
            last_name,
            password: hashedPassword,
          },
          { where: { email: email } }
        );
        await sendEmail(mailOptions);
        return res.json({ success: true });
      }
    }
    const user_role = await Role.findOne({ where: { role: "user" } });
    const hashedPassword = await hashPassword(password);
    const user = new User({
      first_name,
      last_name,
      email,
      roleId: user_role.id,
      password: hashedPassword,
      isLocalAuth: true,
    });
    await user.save();
    await sendEmail(mailOptions);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

// Login a user
exports.loginUser = async (req, res, next) => {
  // Check if email exists
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg });
  }
  try {
    const { login_email, login_password, rememberme } = req.body;
    const user = login_email && (await isEmailExist(login_email));
    if (user && user.isLocalAuth &&user.isActive) {
      //if not validated send email
      if (!user.isEmailConfirmed) {
        const token = jwt.sign({ email: user.email }, process.env.SECRET);
        const mailOptions = {
          from: process.env.EMAIL,
          to: login_email,
          subject: "Account Confirmation Link",
          text: "Follow the link to confirm your email for TestRxMD",
          html: `${process.env.CONFIRM_LINK}?verifyToken=${token}`,
        };
        await sendEmail(mailOptions);
        handleError(
          "It seems like you haven't verified your email yet. Please check your email for the confirmation link.",
          400
        );
      }
      if (await isPasswordCorrect(login_password, user.password)) {
        const token = rememberme
          ? await issueLongtimeToken(
              user.id,
              user.role?.role,
              login_email,
              process.env.SECRET
            )
          : await issueToken(user.id, user.role.role,login_email, process.env.SECRET);
        const info = {
          first_name: user.first_name,
          last_name: user.last_name,
          role: user.role,
          email: user.email,
        };
        bouncer.reset(req);
        return res
          .cookie("access_token", token, {
            path: "/",
            secure: true,
          })
          .json({ auth: true, info });
      }
      handleError("Username or Password Incorrect", 400);
    }
    handleError("Username or Password Incorrect", 400);
  } catch (err) {
    next(err);
  }
};
//get user
exports.getUsers = async (req, res, next) => {
  try {
    // const { page, paginate } = req.query;
    const options = {
      include: ["role"],
      // page: Number(page) || 1,
      // paginate: Number(paginate) || 1,
      order: [["first_name", "DESC"]],
      // where: { name: { [Op.like]: `%elliot%` } }
    };
    const users = await User.findAll(options);
    return res.json(users);
  } catch (err) {
    next(err);
  }
};
//get user by id
exports.getUserById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = await User.findByPk(id, { include: ["role"] });
    return res.json(user);
  } catch (err) {
    next(err);
  }
};
//get user by email
exports.getUserByStatus = async (req, res, next) => {
  try {
    let queryString
    const { email,name } = req.query;
    if(email){queryString={email:email}}
    if(name){queryString={
      [Op.or]: [{first_name:{[Op.like]: `%${name}%`}},
       {last_name:{[Op.like]: `%${name}%`}}]
    }
  }
    const user = await User.findAll(
      {where:queryString, include: ["role"] });
    return res.json(user);
  } catch (err) {
    next(err);
  }
};
// get current loged user
exports.getCurrentLoggedUser = async (req, res, next) => {
  try {
    const id = req.user.sub;
    const user = await User.findByPk(id, { include: ["role"] });
    return res.json(user);
  } catch (err) {
    next(err);
  }
};
//update user info
exports.updateUserInfo = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (req.body.password) {
      delete req.body.password;
    }
    const new_user_info=removeEmptyPair(req.body)
    console.log(new_user_info)
    const updated_user = await User.update(
      { ...new_user_info },
      { where: { id: id } }
    );
    return res.json(updated_user);
  } catch (err) {
    next(err);
  }
};
//change user state
exports.updateUserState = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {state}=req.body
    const updated_user = await User.update(
      { isActive:state },
      { where: { id: id } }
    );
    return res.json(updated_user);
  } catch (err) {
    next(err);
  }
};
//change password
exports.changePassword = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: errors.array()[0].msg });
    }
    const id = req.user.sub;
    const user = await User.findByPk(id);
    if (!user) {
      handleError("user not found", 403);
    }
    const { old_password, new_password } = req.body;
    if (await isPasswordCorrect(old_password, user.password)) {
      const hashedPassword = await hashPassword(new_password);
      const updated_user = await User.update(
        { password: hashedPassword },
        { where: { id: id } }
      );
      return res.json(updated_user);
    }
    handleError("old password not correct", 403);
  } catch (err) {
    next(err);
  }
};
//forgot password
exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const token = jwt.sign({ email: email }, process.env.SECRET, {
      expiresIn: "2h",
    });
    const mailOptions = {
      from: process.env.EMAIL,
      to: email,
      subject: "Password Reset Link",
      text: "Follow the link to reset your password!",
      html: `${process.env.RESET_LINK}?token=${token}`,
    };
    await sendEmail(mailOptions);
    return res.json({
      status: true,
      message:
        "password reset-link sent, please check your email. token will expired in 2 hour",
    });
  } catch (err) {
    next(err);
  }
};
//reset password
exports.resetPassword = async (req, res, next) => {
  try {
    const { token } = req.query;
    const { password } = req.body;
    const user = await isTokenValid(token);
    const hashedPassword = await hashPassword(password);
    await User.update(
      { password: hashedPassword },
      {
        where: { email: user.email },
      }
    );
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
};
//confirm email
exports.confirmEmail = async (req, res, next) => {
  try {
    const { verifyToken } = req.query;
    const user = await isTokenValid(verifyToken);
    if (user) {
      const userInfo = await User.findOne({ where: { email: user.email } });
      userInfo.isEmailConfirmed = true;
      await userInfo.save();
      return res.redirect("/");
    }
    return res.redirect("/login");
  } catch (err) {
    next(err);
  }
};
exports.checkAuth = async(req, res, next) => {
  try {
    const token = req.cookies.access_token;
    if (!token) {
      handleError("please login", 403);
    }
    const user=await asyncVerify(token, process.env.SECRET)
    if(user?.sub){
      const check_user=await User.findByPk(user?.sub)
      if(!check_user?.isActive){
        handleError("This account is inactive, please contact our customer service", 403);
      }
      return res.json({ message: "success", auth: true,user:user });
    }
    handleError("please login", 403);
  } catch (err) {
    next(err);
  }
};

exports.logOut = async (req, res, next) => {
  try {
    return res.status(200).clearCookie('access_token').redirect("/login");;
  } catch (err) {
    next(err);
  }
};

//contact for email
exports.contactFormEmail = async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg });
  }
  try {
    const { name, email, phone, subject,message } = req.body;
    const receiveOptions = {
      from: email,
      to: process.env.EMAIL,
      text: "customer request",
      subject: subject,
      html: `You got a message from
      Email : ${email}
      ${name && "Name:" + name}
      ${phone && "Phone:" + phone}
      Message: ${message}`,
    };
    await sendEmail(receiveOptions);
    //send automatic reply email
    const replyOptions = {
      from: process.env.EMAIL,
      to: email,
      text: "automatic reply,please don't reply",
      subject: "reciving your request",
      html: `we got your request we will contact you soon`,
    };
    await sendEmail(replyOptions);
    return res.json({
      message: "email successfuly sent",
    });
  } catch (err) {
    next(err);
  }
};
exports.adminDashboard = async (req, res, next) => {
  try {
    // const { page, paginate } = req.query;
    const options = {
      // include: ["brand", "category"],
      // attributes: { exclude: ['categoryId', 'brandId'] },
      // page: Number(page) || 1,
      // paginate: Number(paginate) || 25,
      order: [["product_name", "ASC"]],
    };
    const products = await Product.findAll(options);
    return res.render(path.join(__dirname, "..", "/views/pages/dashboard"),{products});
  } catch (err) {
    next(err);
  }
};
exports.jotformWebhook = async (req, res, next) => {
  try {
    const { pretty } = req.body;
    const jot_pairs = pretty.replace(/\s/g, "").split(",");
    const jot_entries = jot_pairs.map((kv) => kv.split(":"));
    const jot_obj = Object.fromEntries(jot_entries);
    const token = jot_obj.token;
    const user = await isTokenValid(token);
    await User.update(
      { intake: true },
      {
        where: { email: user.email },
      }
    );
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
};
